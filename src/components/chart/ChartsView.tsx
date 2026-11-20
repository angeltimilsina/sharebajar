"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProChart } from "./ProChart";
import { TradeFeed } from "../trade/TradeFeed";
import { MarketPicker } from "../trade/MarketPicker";
import { getChain, isValidAddressFor } from "@/lib/chains";
import type { DexPair } from "@/lib/types";
import { Notice } from "../ui/primitives";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainLabel } from "../ui/ChainIcon";
import { formatPrice, formatUsd } from "@/lib/format";

export function ChartsView() {
  const sp = useSearchParams();
  const router = useRouter();
  const chain = getChain(sp.get("chain"));
  const token = sp.get("token") ?? "";
  const dexMode = !!chain && isValidAddressFor(chain, token);
  const symbol = (sp.get("symbol") ?? "BTCUSDT").toUpperCase();
  const [pairs, setPairs] = useState<DexPair[]>([]);
  const [poolIdx, setPoolIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!dexMode) return;
    fetch(`/api/dex/pairs?chain=${chain!.id}&address=${token}`).then((r) => r.json()).then((b) => { if (b.error) throw new Error(b.error); setPairs(b.data ?? []); setPoolIdx(0); }).catch((e) => setErr(String(e.message)));
  }, [dexMode, chain, token]);
  const pool = pairs[poolIdx];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {dexMode ? (
          pool ? (
            <div className="flex items-center gap-3 h-12 rounded-xl border border-line bg-surface px-3">
              <TokenIcon src={pool.imageUrl} symbol={pool.base.symbol} size={26} />
              <span><span className="block font-bold leading-tight">{pool.base.symbol}/{pool.quote.symbol}</span><ChainLabel chain={pool.chain} /></span>
              <span className="num font-semibold">{formatPrice(pool.priceUsd)}</span>
              <select value={poolIdx} onChange={(e) => setPoolIdx(Number(e.target.value))} className="h-8 rounded-lg bg-surface-2 border border-line text-xs px-2" aria-label="Pool">
                {pairs.slice(0, 15).map((p, i) => <option key={p.pairAddress} value={i}>{p.dex} · {p.base.symbol}/{p.quote.symbol} · {formatUsd(p.liquidityUsd)}</option>)}
              </select>
            </div>
          ) : <span className="text-sm text-muted">{err ?? "Loading pools…"}</span>
        ) : (
          <MarketPicker value={symbol} onChange={(p) => router.replace(`/charts?symbol=${p}`)} />
        )}
        <span className="text-xs text-muted">Scroll to zoom · drag to pan · pinch on touch devices · use the toolbar for indicators and drawings</span>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {dexMode ? (pool ? <ProChart feed={{ kind: "dex", chain: chain!.id, pool: pool.pairAddress }} label={`${pool.base.symbol}/${pool.quote.symbol}`} height={680} /> : <Notice>{err ?? "Loading…"}</Notice>)
          : <ProChart feed={{ kind: "binance", symbol }} label={`${symbol.replace(/USDT$/, "")}/USDT`} height={680} defaultRes="1s" />}
        {dexMode ? (pool && <TradeFeed source={{ kind: "dex", chain: chain!.id, pool: pool.pairAddress, base: pool.base.symbol }} height={620} />)
          : <TradeFeed source={{ kind: "binance", symbol, base: symbol.replace(/USDT$/, "") }} height={620} />}
      </div>
    </div>
  );
}

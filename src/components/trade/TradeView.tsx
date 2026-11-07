"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ProChart } from "../chart/ProChart";
import { OrderBook } from "./OrderBook";
import { TradeFeed } from "./TradeFeed";
import { SwapPanel } from "./SwapPanel";
import { MarketPicker } from "./MarketPicker";
import { Notice } from "../ui/primitives";
import { TokenIcon } from "../ui/TokenIcon";
import { formatPrice, formatUsd } from "@/lib/format";
import type { DexPair } from "@/lib/types";

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;

export function TradeView() {
  const sp = useSearchParams();
  const router = useRouter();
  const output = sp.get("output") ?? undefined;
  const side = sp.get("side") === "sell" ? "sell" : "buy";
  const symParam = (sp.get("symbol") ?? "").toUpperCase();
  const symbol = SYMBOL_RE.test(symParam) ? symParam : "SOLUSDT";
  const [pair, setPair] = useState<DexPair | null>(null);
  const [pairErr, setPairErr] = useState<string | null>(null);

  useEffect(() => {
    if (!output || output === "So11111111111111111111111111111111111111112") { setPair(null); return; }
    fetch(`/api/dex/pairs?chain=solana&address=${output}`).then((r) => r.json()).then((b) => {
      if (b.error) throw new Error(b.error);
      setPair(b.data?.[0] ?? null);
      if (!b.data?.length) setPairErr("No on-chain pools found for this token.");
    }).catch((e) => setPairErr(String(e.message)));
  }, [output]);

  const dex = !!output && !!pair;
  const base = symbol.replace(/USDT$/, "");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {dex ? (
          <Link href={`/token/solana/${pair!.base.address}`} className="flex items-center gap-3 h-12 rounded-xl border border-line bg-surface px-3 hover:bg-surface-2">
            <TokenIcon src={pair!.imageUrl} symbol={pair!.base.symbol} size={26} />
            <span><span className="block font-bold leading-tight">{pair!.base.symbol}<span className="text-muted font-medium">/{pair!.quote.symbol}</span></span><span className="text-[11px] text-muted">{pair!.dex} · Solana</span></span>
            <span className="num font-semibold ml-2">{formatPrice(pair!.priceUsd)}</span>
            <span className="text-xs text-muted">Liq {formatUsd(pair!.liquidityUsd)}</span>
          </Link>
        ) : (
          <MarketPicker value={symbol} onChange={(p) => router.replace(`/trade?symbol=${p}${output ? `&output=${output}` : ""}`)} />
        )}
        {output && dex && <button onClick={() => router.replace(`/trade?symbol=${symbol}`)} className="text-xs text-muted hover:text-fg">Switch to Binance markets</button>}
        {pairErr && <span className="text-xs text-warn">{pairErr}</span>}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px_380px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4 min-w-0">
          {dex ? <ProChart feed={{ kind: "dex", chain: "solana", pool: pair!.pairAddress }} label={`${pair!.base.symbol}/${pair!.quote.symbol}`} height={520} defaultRes="1m" />
            : <ProChart feed={{ kind: "binance", symbol }} label={`${base}/USDT`} height={520} defaultRes="1m" />}
          <TradeFeed source={dex ? { kind: "dex", chain: "solana", pool: pair!.pairAddress, base: pair!.base.symbol } : { kind: "binance", symbol, base }} height={300} />
        </div>
        <div className="min-w-0 hidden xl:block">
          {dex ? <Notice>AMM pool — no order book. Execution prices come from pool reserves via Jupiter routing.</Notice> : <OrderBook symbol={symbol} base={base} rows={14} />}
        </div>
        <div className="space-y-4 min-w-0">
          <SwapPanel defaultOutput={output} side={side} />
          {!dex && <Notice>The chart and order book show Binance spot markets for price discovery. Swaps execute on-chain on Solana via Jupiter — prices may differ slightly from centralized exchanges.</Notice>}
          <div className="xl:hidden">{!dex && <OrderBook symbol={symbol} base={base} rows={10} />}</div>
        </div>
      </div>
    </div>
  );
}

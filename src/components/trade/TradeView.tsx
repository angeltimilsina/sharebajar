"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import clsx from "clsx";
import { ProChart } from "../chart/ProChart";
import { OrderBook } from "./OrderBook";
import { TradeFeed } from "./TradeFeed";
import { MarketPicker } from "./MarketPicker";
import { Card, CardHeader, Notice } from "../ui/primitives";
import { TradeSideCards } from "./TradeSideCards";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainLabel } from "../ui/ChainIcon";
import { AssetExecution, type ExecAsset, type ExecMode } from "../asset/AssetExecution";
import { formatPrice, formatUsd } from "@/lib/format";
import { getChain, isValidAddressFor } from "@/lib/chains";
import { NATIVE_EVM, ZEROX_CHAINS } from "@/lib/treasury/tokens";
import type { DexPair } from "@/lib/types";

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const NATIVE: Record<string, { chain: string; token: string }> = {
  SOL: { chain: "solana", token: SOL_MINT }, ETH: { chain: "ethereum", token: NATIVE_EVM }, BNB: { chain: "bsc", token: NATIVE_EVM },
  POL: { chain: "polygon", token: NATIVE_EVM }, AVAX: { chain: "avalanche", token: NATIVE_EVM },
};

/**
 * The Trade workspace: pick any market (exchange pair or on-chain token) and
 * execute in the same place — chart, order book / liquidity, and the shared
 * Trade/Swap execution panel used on every asset page.
 *   /trade?symbol=SOLUSDT          exchange market (Binance chart + order book)
 *   /trade?chain=base&token=0x…    on-chain token (DEX chart + pool liquidity)
 *   /trade?output=<solana mint>    (legacy) Solana token
 *   &mode=swap&side=sell           execution mode / side
 */
export function TradeView() {
  const sp = useSearchParams();
  const router = useRouter();
  const legacyOut = sp.get("output");
  const chain = getChain(sp.get("chain") ?? (legacyOut ? "solana" : null));
  const token = sp.get("token") ?? legacyOut ?? "";
  const dexMode = !!chain && isValidAddressFor(chain, token) && token !== SOL_MINT;
  const symParam = (sp.get("symbol") ?? "").toUpperCase();
  const symbol = SYMBOL_RE.test(symParam) ? symParam : "SOLUSDT";
  const base = symbol.replace(/(USDT|USDC|FDUSD)$/, "");
  const mode: ExecMode = sp.get("mode") === "swap" ? "swap" : "trade";
  const side = sp.get("side") === "sell" ? "sell" : "buy";

  const [pair, setPair] = useState<DexPair | null>(null);
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [cexExec, setCexExec] = useState<{ chain: string | null; token: string | null; coinId?: string } | null>(null);

  const setParams = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null) q.delete(k); else q.set(k, v); }
    router.replace(`/trade?${q}`, { scroll: false });
  };

  // On-chain token: load its pools (deepest first).
  useEffect(() => {
    setPair(null); setPairErr(null);
    if (!dexMode) return;
    fetch(`/api/dex/pairs?chain=${chain!.id}&address=${token}`).then((r) => r.json()).then((b) => {
      if (b.error) throw new Error(b.error);
      const list = (b.data ?? []) as DexPair[];
      const want = sp.get("pair");
      setPair(list.find((p) => p.pairAddress === want) ?? list[0] ?? null);
      if (!list.length) setPairErr("No on-chain pools found for this token.");
    }).catch((e) => setPairErr(String(e.message)));
  }, [dexMode, chain?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exchange market: find where it can be executed on-chain + its asset page.
  useEffect(() => {
    if (dexMode) return;
    setCexExec(null);
    let alive = true;
    (async () => {
      const coin = await fetch(`/api/search?q=${base}`).then((r) => r.json()).then((b) => (b.coins ?? []).find((c: { symbol: string }) => c.symbol.toUpperCase() === base)).catch(() => null);
      if (NATIVE[base]) { if (alive) setCexExec({ ...NATIVE[base], coinId: coin?.id }); return; }
      const t = await fetch(`/api/swap/tokens?q=${base}`).then((r) => r.json()).then((b) => (b.data ?? []).filter((x: { verified: boolean; symbol: string; liquidity?: number }) => x.verified && x.symbol.toUpperCase() === base).sort((a: { liquidity?: number }, b: { liquidity?: number }) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0]).catch(() => null);
      if (alive) setCexExec({ chain: t && (t.liquidity ?? 0) > 100_000 ? "solana" : null, token: t && (t.liquidity ?? 0) > 100_000 ? t.address : null, coinId: coin?.id });
    })();
    return () => { alive = false; };
  }, [dexMode, base]);

  const execAsset: ExecAsset | null = useMemo(() => {
    if (dexMode) {
      if (!pair) return null;
      const exec = chain!.id === "solana" || chain!.id in ZEROX_CHAINS;
      return { symbol: pair.base.symbol, name: pair.base.name, href: `/token/${chain!.id}/${token}?pair=${pair.pairAddress}`, chain: exec ? chain!.id : null, token: exec ? token : null, unavailableReason: `In-app execution isn't available on ${chain!.name} yet.` };
    }
    if (!cexExec) return null;
    return { symbol: base, name: base, href: cexExec.coinId ? `/coin/${cexExec.coinId}` : `/trade?symbol=${symbol}`, chain: cexExec.chain, token: cexExec.token };
  }, [dexMode, pair, chain, token, cexExec, base, symbol]);

  const detailHref = dexMode ? (pair ? `/token/${chain!.id}/${token}?pair=${pair.pairAddress}` : null) : cexExec?.coinId ? `/coin/${cexExec.coinId}` : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[30px] sm:text-[34px] leading-tight">Trade</h1>
        <p className="text-muted text-[14.5px] mt-1">Live charts and order books, with swaps that execute from your own wallet.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {dexMode ? (
          pair ? (
            <div className="flex items-center gap-3 h-12 rounded-full bg-surface px-4">
              <TokenIcon src={pair.imageUrl} symbol={pair.base.symbol} size={26} />
              <span><span className="block font-semibold leading-tight">{pair.base.symbol}<span className="text-muted font-medium">/{pair.quote.symbol}</span></span><span className="text-[11px] text-muted inline-flex items-center gap-1">{pair.dex} · <ChainLabel chain={chain!.id} /></span></span>
              <span className="num font-semibold ml-2">{formatPrice(pair.priceUsd)}</span>
              <span className="text-xs text-muted hidden sm:inline">Liq {formatUsd(pair.liquidityUsd)}</span>
            </div>
          ) : <div className="h-12 w-64 skeleton rounded-2xl" />
        ) : (
          <MarketPicker value={symbol} onChange={(p) => router.replace(`/trade?symbol=${p}${mode === "swap" ? "&mode=swap" : ""}`, { scroll: false })} />
        )}
        {detailHref && <Link href={detailHref} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">Asset details <ArrowUpRight size={14} /></Link>}
        {dexMode && <button onClick={() => router.replace("/trade?symbol=SOLUSDT", { scroll: false })} className="text-xs text-muted hover:text-fg">Browse exchange markets</button>}
        {pairErr && <span className="text-xs text-warn">{pairErr}</span>}
      </div>

      <div className={clsx("grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]", mode === "trade" && "xl:grid-cols-[minmax(0,1fr)_300px_380px]")}>
        <div className="space-y-4 min-w-0">
          {dexMode ? (pair ? <ProChart feed={{ kind: "dex", chain: chain!.id, pool: pair.pairAddress }} label={`${pair.base.symbol}/${pair.quote.symbol}`} height={520} defaultRes="1m" /> : <div className="h-[520px] skeleton rounded-2xl" />)
            : <ProChart feed={{ kind: "binance", symbol }} label={`${base}/USDT`} height={520} defaultRes="1m" />}
          {(dexMode ? pair : true) && <TradeFeed source={dexMode ? { kind: "dex", chain: chain!.id, pool: pair!.pairAddress, base: pair!.base.symbol } : { kind: "binance", symbol, base }} height={300} />}
        </div>
        {mode === "trade" && (
          <div className="min-w-0 hidden xl:block">
            {dexMode ? <Liquidity pair={pair} /> : <OrderBook symbol={symbol} base={base} rows={14} />}
          </div>
        )}
        <div className="space-y-4 min-w-0">
          {execAsset ? (
            <AssetExecution asset={execAsset} mode={mode} onMode={(m) => setParams({ mode: m === "trade" ? null : m })} side={side} onSide={(s) => setParams({ side: s === "buy" ? null : s })} />
          ) : <div className="panel h-80 skeleton" />}
          {!dexMode && <Notice>Chart and order book show Binance spot markets for price discovery. Execution happens on-chain from your wallet, so prices can differ slightly.</Notice>}
          <TradeSideCards />
          <div className="xl:hidden">{mode === "trade" && (dexMode ? <Liquidity pair={pair} /> : <OrderBook symbol={symbol} base={base} rows={10} />)}</div>
        </div>
      </div>
    </div>
  );
}

function Liquidity({ pair }: { pair: DexPair | null }) {
  if (!pair) return <div className="panel h-40 skeleton" />;
  return (
    <Card>
      <CardHeader title="Liquidity" sub={`${pair.dex} · AMM pool`} />
      <div className="px-4 pb-4 space-y-2 text-[13px]">
        <div className="flex justify-between"><span className="text-muted">Pool liquidity</span><span className="num font-medium">{formatUsd(pair.liquidityUsd)}</span></div>
        <div className="flex justify-between"><span className="text-muted">24h volume</span><span className="num">{formatUsd(pair.volume.h24)}</span></div>
        <p className="text-xs text-muted leading-relaxed pt-1">No order book: AMM pools price trades from reserves. Check price impact before confirming larger orders.</p>
      </div>
    </Card>
  );
}

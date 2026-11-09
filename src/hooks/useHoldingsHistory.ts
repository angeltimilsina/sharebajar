"use client";
import { useEffect, useMemo, useState } from "react";
import type { WalletBalance } from "./useWallets";

export type Range = "24h" | "7d" | "30d";
const RES: Record<Range, { res: string; bars: number }> = { "24h": { res: "1h", bars: 24 }, "7d": { res: "4h", bars: 42 }, "30d": { res: "1d", bars: 30 } };
const STABLES = new Set(["USDC", "USDT", "DAI", "USDS", "USDE", "FDUSD", "PYUSD", "TUSD", "USDC.E", "USDBC"]);
/** Price ticker for an asset: wrapped/staked majors track their underlying. */
const priceSymbol = (s: string) => {
  const u = s.toUpperCase();
  if (["WBTC", "CBBTC", "TBTC", "BTCB", "BTC.B"].includes(u)) return "BTC";
  if (u === "WETH") return "ETH";
  if (u === "WSOL") return "SOL";
  return u;
};

export interface Asset { key: string; symbol: string; amount: number; value: number; change24h: number | null; wallets: { id: string; label: string; chain: string; value: number }[] }
export interface HistoryPoint { t: number; v: number }

/** Merge holdings from the selected wallets into one row per asset (by price ticker). */
export function mergeAssets(balances: WalletBalance[]): Asset[] {
  const m = new Map<string, Asset>();
  for (const b of balances) for (const h of b.holdings) {
    if (!h.usdValue || h.usdValue < 0.01) continue;
    const key = priceSymbol(h.symbol);
    const a = m.get(key) ?? { key, symbol: key, amount: 0, value: 0, change24h: h.change24h ?? null, wallets: [] };
    a.amount += h.amount;
    a.value += h.usdValue;
    const w = a.wallets.find((x) => x.id === b.wallet.id);
    if (w) w.value += h.usdValue; else a.wallets.push({ id: b.wallet.id, label: b.wallet.label, chain: b.wallet.chain, value: h.usdValue });
    m.set(key, a);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

/**
 * Value of the CURRENT holdings over the chosen range, priced with real
 * Binance candles. Not past balances: it shows how today's portfolio would
 * have moved. Stablecoins are $1; assets without a Binance market stay at
 * today's value (flat) and are listed as such.
 */
export function useHoldingsHistory(assets: Asset[], range: Range, symbols: Record<string, string>) {
  const priced = useMemo(() => assets.filter((a) => !STABLES.has(a.symbol) && symbols[a.symbol]).slice(0, 8), [assets, symbols]);
  const key = `${range}|${priced.map((a) => `${a.symbol}:${a.amount.toPrecision(6)}`).join(",")}|${assets.length}`;
  const [state, setState] = useState<{ points: HistoryPoint[]; loading: boolean; flat: string[] }>({ points: [], loading: false, flat: [] });

  useEffect(() => {
    if (!assets.length) { setState({ points: [], loading: false, flat: [] }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const { res, bars } = RES[range];
    Promise.allSettled(priced.map((a) => fetch(`/api/candles?symbol=${symbols[a.symbol]}&res=${res}`).then((r) => r.json()).then((b) => ({ a, candles: ((b.data ?? []) as { time: number; close: number }[]).slice(-bars) }))))
      .then((results) => {
        if (!alive) return;
        const series = results.flatMap((r) => (r.status === "fulfilled" && r.value.candles.length ? [r.value] : []));
        const charted = new Set(series.map((s) => s.a.symbol));
        const flatValue = assets.filter((a) => !charted.has(a.symbol)).reduce((s, a) => s + a.value, 0);
        const flat = assets.filter((a) => !charted.has(a.symbol) && !STABLES.has(a.symbol)).map((a) => a.symbol);
        const times = series.length ? series.reduce((longest, s) => (s.candles.length > longest.length ? s.candles : longest), series[0].candles).map((c) => c.time) : [];
        const points: HistoryPoint[] = times.map((t) => {
          let v = flatValue;
          for (const s of series) {
            // Close of the latest bar at or before t (series can start later for new listings).
            let c = s.candles[0];
            for (const x of s.candles) { if (x.time <= t) c = x; else break; }
            v += s.a.amount * c.close;
          }
          return { t: t * 1000, v };
        });
        // End exactly on today's value.
        points.push({ t: Date.now(), v: assets.reduce((s, a) => s + a.value, 0) });
        setState({ points, loading: false, flat });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

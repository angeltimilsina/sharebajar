import type { DexPair, Pool, Trade } from "../types";

export type SignalKind = "volume-spike" | "buy-pressure" | "sell-pressure" | "fresh-pool" | "thin-liquidity" | "breakout" | "dump";

export interface Signal { kind: SignalKind; label: string; tone: "up" | "down" | "warn" | "info"; detail: string }

/** Data-driven activity flags for a DEX pool. Deterministic, explainable. */
export function poolSignals(p: Pool | DexPair, now = Date.now()): Signal[] {
  const out: Signal[] = [];
  const liq = "reserveUsd" in p ? p.reserveUsd : p.liquidityUsd;
  const v24 = p.volume.h24 ?? 0;
  const v1 = p.volume.h1 ?? 0;
  const tx = "txns" in p ? p.txns.h1 : undefined;

  if (liq && v24 / liq > 5) out.push({ kind: "volume-spike", label: `Vol/Liq ${(v24 / liq).toFixed(1)}×`, tone: "warn", detail: "24h volume far exceeds pool liquidity — high turnover or wash trading." });
  if (v24 > 0 && v1 * 24 > v24 * 3 && v1 > 10_000) out.push({ kind: "volume-spike", label: "1h volume surge", tone: "info", detail: "Last-hour volume running >3× the 24h hourly average." });
  if (tx && tx.buys + tx.sells >= 20) {
    const r = tx.buys / (tx.buys + tx.sells);
    if (r >= 0.7) out.push({ kind: "buy-pressure", label: `Buys ${(r * 100).toFixed(0)}%`, tone: "up", detail: "Buy transactions dominate the last hour." });
    if (r <= 0.3) out.push({ kind: "sell-pressure", label: `Sells ${((1 - r) * 100).toFixed(0)}%`, tone: "down", detail: "Sell transactions dominate the last hour." });
  }
  if (p.createdAt && now - p.createdAt < 24 * 3600_000) out.push({ kind: "fresh-pool", label: "< 24h old", tone: "info", detail: "Pool created in the last 24 hours." });
  if (liq !== null && liq !== undefined && liq < 10_000) out.push({ kind: "thin-liquidity", label: "Thin liquidity", tone: "warn", detail: "Under $10K liquidity — large trades will move price sharply." });
  if ((p.change.h1 ?? 0) > 25) out.push({ kind: "breakout", label: `+${(p.change.h1 ?? 0).toFixed(0)}% 1h`, tone: "up", detail: "Strong price move in the last hour." });
  if ((p.change.h1 ?? 0) < -25) out.push({ kind: "dump", label: `${(p.change.h1 ?? 0).toFixed(0)}% 1h`, tone: "down", detail: "Sharp decline in the last hour." });
  return out;
}

/**
 * Flags unusually large trades: notional above max(minUsd, p95 of window).
 */
export function largeTradeThreshold(trades: Trade[], minUsd = 5_000): number {
  if (trades.length < 20) return minUsd;
  const sorted = trades.map((t) => t.notional).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return Math.max(minUsd, p95);
}

export function buySellSummary(trades: Trade[]) {
  let buys = 0, sells = 0, buyUsd = 0, sellUsd = 0;
  for (const t of trades) {
    if (t.side === "buy") { buys++; buyUsd += t.notional; } else { sells++; sellUsd += t.notional; }
  }
  const total = buyUsd + sellUsd;
  return { buys, sells, buyUsd, sellUsd, buyRatio: total ? buyUsd / total : 0.5 };
}

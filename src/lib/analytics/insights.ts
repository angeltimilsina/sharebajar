import type { CoinMarket, DexPair } from "../types";
import { formatPct, formatUsd } from "../format";
import { poolSignals } from "./signals";

export interface Insight { text: string; tone?: "up" | "down" | "warn" | "info" }

/** Plain-language observations derived from market data (no AI, no prediction). */
export function coinInsights(m: CoinMarket, ath?: number | null): Insight[] {
  const out: Insight[] = [];
  if (m.change24h !== null && m.change7d !== null) {
    const dir = (v: number) => (v >= 0 ? "up" : "down");
    out.push({ text: `Price is ${dir(m.change24h)} ${formatPct(Math.abs(m.change24h)).replace("+", "")} over 24h and ${dir(m.change7d)} ${formatPct(Math.abs(m.change7d)).replace("+", "")} over 7 days.`, tone: m.change24h >= 0 ? "up" : "down" });
  }
  if (m.volume24h && m.marketCap) {
    const r = m.volume24h / m.marketCap;
    out.push({ text: `24h volume is ${(r * 100).toFixed(1)}% of market cap — ${r > 0.25 ? "unusually heavy turnover" : r < 0.02 ? "light trading activity" : "typical turnover"}.`, tone: r > 0.25 ? "warn" : "info" });
  }
  const athV = ath ?? m.ath;
  if (athV && m.price) {
    const d = ((m.price - athV) / athV) * 100;
    out.push({ text: d > -3 ? "Trading near its all-time high." : `Trading ${Math.abs(d).toFixed(1)}% below its all-time high of ${formatUsd(athV)}.`, tone: d > -3 ? "up" : "info" });
  }
  if (m.high24h && m.low24h && m.price && m.high24h > m.low24h) {
    const pos = (m.price - m.low24h) / (m.high24h - m.low24h);
    out.push({ text: `Sits at ${(pos * 100).toFixed(0)}% of today's range (${formatUsd(m.low24h)} – ${formatUsd(m.high24h)}).` });
  }
  if (m.fdv && m.marketCap && m.fdv > m.marketCap * 1.5) {
    out.push({ text: `Fully diluted value is ${(m.fdv / m.marketCap).toFixed(1)}× market cap — significant future supply unlocks possible.`, tone: "warn" });
  }
  return out;
}

export function tokenInsights(p: DexPair, extra: { top10Pct?: number | null; riskLevel?: string | null; pairCount?: number } = {}): Insight[] {
  const out: Insight[] = [];
  const t = p.txns.h24;
  if (t.buys + t.sells > 0) {
    const r = t.buys / (t.buys + t.sells);
    out.push({ text: `${t.buys.toLocaleString()} buys vs ${t.sells.toLocaleString()} sells in 24h (${(r * 100).toFixed(0)}% buys).`, tone: r > 0.6 ? "up" : r < 0.4 ? "down" : "info" });
  }
  if (p.liquidityUsd !== null) out.push({ text: `Deepest pool holds ${formatUsd(p.liquidityUsd)} of liquidity${extra.pairCount && extra.pairCount > 1 ? ` across ${extra.pairCount} pairs` : ""}.`, tone: p.liquidityUsd < 50_000 ? "warn" : "info" });
  for (const s of poolSignals(p)) out.push({ text: `${s.label}: ${s.detail}`, tone: s.tone === "info" ? "info" : s.tone });
  if (extra.top10Pct !== null && extra.top10Pct !== undefined) out.push({ text: `Top 10 holders control ${extra.top10Pct.toFixed(1)}% of supply.`, tone: extra.top10Pct > 50 ? "warn" : "info" });
  if (extra.riskLevel === "high") out.push({ text: "Contract checks flagged high-risk permissions — review the security panel.", tone: "down" });
  return out.slice(0, 7);
}

import type { CoinMarket, Pool } from "../types";
import { poolSignals } from "../analytics/signals";

/**
 * The home market board: one list, many lenses. Rows come from listed coins
 * (all networks) or on-chain pools (a single network). Every value and signal
 * is derived from live data — nothing here is a prediction.
 */
export type Lens = "top" | "gainers" | "losers" | "active" | "trending" | "new" | "watchlist";
export type Stat = "change1h" | "change24h" | "change7d" | "volume" | "marketCap" | "liquidity" | "fdv";

export const LENSES: { id: Lens; label: string; hint: string }[] = [
  { id: "top", label: "Top", hint: "Largest by market cap" },
  { id: "gainers", label: "Gainers", hint: "Biggest rises" },
  { id: "losers", label: "Losers", hint: "Biggest drops" },
  { id: "active", label: "Most active", hint: "Highest trading volume" },
  { id: "trending", label: "Trending", hint: "Most active on-chain pools" },
  { id: "new", label: "New", hint: "Pools created recently" },
  { id: "watchlist", label: "Watchlist", hint: "Saved on this device" },
];

export const STAT_LABEL: Record<Stat, string> = {
  change1h: "1h", change24h: "24h", change7d: "7d", volume: "Volume", marketCap: "Mkt cap", liquidity: "Liquidity", fdv: "FDV",
};

/** Stats that make sense for each kind of row. */
export const COIN_STATS: Stat[] = ["change24h", "change7d", "change1h", "volume", "marketCap"];
export const POOL_STATS: Stat[] = ["change24h", "change1h", "volume", "liquidity", "fdv"];
export const isChange = (s: Stat) => s === "change1h" || s === "change24h" || s === "change7d";

export interface BoardSignal { label: string; tone: "up" | "down" | "warn" | "info"; detail: string }

export interface BoardRow {
  key: string;
  kind: "coin" | "pool";
  href: string;
  symbol: string;
  name: string;
  image: string | null;
  rank: number | null;
  network: string | null;
  pair: string | null;
  price: number | null;
  stats: Partial<Record<Stat, number | null>>;
  spark: number[];
  signals: BoardSignal[];
  /** For watchlist stars. */
  watch: { kind: "coin"; id: string; label: string } | { kind: "token"; id: string; chain: string; address: string; label: string };
  liveSymbol?: string;
}

/** Data-only observations about a listed coin (at most two, strongest first). */
export function coinSignals(c: CoinMarket): BoardSignal[] {
  const out: BoardSignal[] = [];
  const turnover = c.volume24h && c.marketCap ? c.volume24h / c.marketCap : null;
  if ((c.change1h ?? 0) >= 2) out.push({ label: `+${c.change1h!.toFixed(1)}% this hour`, tone: "up", detail: "Moving fast in the last hour." });
  if ((c.change1h ?? 0) <= -2) out.push({ label: `${c.change1h!.toFixed(1)}% this hour`, tone: "down", detail: "Falling fast in the last hour." });
  if ((c.change7d ?? 0) <= -10 && (c.change24h ?? 0) >= 5) out.push({ label: "Rebounding", tone: "up", detail: "Up today after a weekly decline of more than 10%." });
  if ((c.change7d ?? 0) >= 20 && (c.change24h ?? 0) <= -5) out.push({ label: "Pulling back", tone: "down", detail: "Down today after a weekly rise of more than 20%." });
  if (c.high24h && c.low24h && c.price && c.high24h > c.low24h && (c.price - c.low24h) / (c.high24h - c.low24h) >= 0.97) out.push({ label: "At 24h high", tone: "up", detail: "Trading at the top of today's range." });
  if (turnover !== null && turnover >= 0.25) out.push({ label: "Heavy volume", tone: "warn", detail: `24h volume is ${(turnover * 100).toFixed(0)}% of market cap.` });
  return out.slice(0, 2);
}

export function coinRow(c: CoinMarket, binanceSymbol?: string): BoardRow {
  return {
    key: `c:${c.id}`, kind: "coin", href: `/coin/${c.id}`, symbol: c.symbol, name: c.name, image: c.image, rank: c.rank, network: null, pair: null,
    price: c.price,
    stats: { change1h: c.change1h, change24h: c.change24h, change7d: c.change7d, volume: c.volume24h, marketCap: c.marketCap },
    spark: c.sparkline, signals: coinSignals(c), watch: { kind: "coin", id: c.id, label: c.symbol }, liveSymbol: binanceSymbol,
  };
}

export function poolRow(p: Pool, now = Date.now()): BoardRow {
  const sig = poolSignals(p, now).map((s) => ({ label: s.label, tone: s.tone as BoardSignal["tone"], detail: s.detail }));
  return {
    key: `p:${p.network}:${p.address}`, kind: "pool", href: `/token/${p.network}/${p.base.address}?pair=${p.address}`,
    symbol: p.base.symbol, name: p.base.name, image: p.base.image, rank: null, network: p.network, pair: `${p.base.symbol}/${p.quote.symbol}`,
    price: p.priceUsd,
    stats: { change1h: p.change.h1, change24h: p.change.h24, volume: p.volume.h24, liquidity: p.reserveUsd, fdv: p.fdv ?? p.marketCap },
    spark: [], signals: sig.slice(0, 2), watch: { kind: "token", id: p.base.address, chain: p.network, address: p.base.address, label: p.base.symbol },
  };
}

/** Which data a lens needs: listed coins or on-chain pools (and which pool feed). */
export function lensSource(lens: Lens, network: string): { kind: "coins" } | { kind: "pools"; feed: "trending" | "new" | "top" } | { kind: "watchlist" } {
  if (lens === "watchlist") return { kind: "watchlist" };
  if (lens === "trending") return { kind: "pools", feed: "trending" };
  if (lens === "new") return { kind: "pools", feed: "new" };
  return network === "all" ? { kind: "coins" } : { kind: "pools", feed: "top" };
}

const v = (r: BoardRow, s: Stat) => r.stats[s] ?? null;

/**
 * Order rows for a lens. Gainers/losers follow the selected timeframe
 * (1h / 24h / 7d) so "gainers" always means what the stat switch shows.
 * Coins need $1M+ volume to rank as movers (filters illiquid noise).
 */
export function applyLens(rows: BoardRow[], lens: Lens, stat: Stat): BoardRow[] {
  const tf: Stat = isChange(stat) ? stat : "change24h";
  const liquid = (r: BoardRow) => r.kind === "pool" ? (r.stats.liquidity ?? 0) >= 10_000 : (r.stats.volume ?? 0) >= 1_000_000;
  switch (lens) {
    case "gainers": return rows.filter((r) => liquid(r) && (v(r, tf) ?? 0) > 0).sort((a, b) => (v(b, tf) ?? 0) - (v(a, tf) ?? 0)).slice(0, 50);
    case "losers": return rows.filter((r) => liquid(r) && (v(r, tf) ?? 0) < 0).sort((a, b) => (v(a, tf) ?? 0) - (v(b, tf) ?? 0)).slice(0, 50);
    case "active": return [...rows].sort((a, b) => (v(b, "volume") ?? 0) - (v(a, "volume") ?? 0)).slice(0, 50);
    case "top": return rows[0]?.kind === "coin" ? [...rows].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)) : [...rows].sort((a, b) => (v(b, "volume") ?? 0) - (v(a, "volume") ?? 0));
    default: return rows;
  }
}

/** Keep the chosen stat when it applies to these rows; otherwise fall back to 24h. */
export function statFor(rows: BoardRow[], stat: Stat): Stat {
  const allowed = rows[0]?.kind === "pool" ? POOL_STATS : COIN_STATS;
  return allowed.includes(stat) ? stat : "change24h";
}

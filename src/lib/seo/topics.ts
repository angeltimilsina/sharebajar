import type { CoinMarket } from "../types";

/**
 * The searches people make about crypto markets, as page topics.
 * Each topic selects its rows from live data — nothing here is a price.
 * Category membership is a curated symbol list (sector labels, not data).
 */
export type TopicKind = "ranking" | "category" | "dex";

export interface Topic {
  slug: string;
  kind: TopicKind;
  /** Short label for links and nav. */
  label: string;
  /** Page <title> and H1 ("… today"). */
  title: string;
  /** Phrases people search, used in copy and keywords. */
  queries: string[];
  /** What the list contains, in one sentence. */
  blurb: string;
  /** Sort / filter for coin topics. */
  select?: (coins: CoinMarket[]) => CoinMarket[];
  /** Which metric the ranking is about (for narrative + table emphasis). */
  metric?: "change24h" | "change7d" | "volume24h" | "marketCap";
  /** DEX topics: GeckoTerminal source. */
  dex?: { source: "trending" | "new" | "top"; network?: string; chain?: string };
}

const liquid = (c: CoinMarket) => (c.volume24h ?? 0) >= 1_000_000 && (c.marketCap ?? 0) >= 10_000_000;
/** Comparator on a numeric field: -1 = descending (default), 1 = ascending. Missing values sort as 0. */
const by = (k: keyof CoinMarket, dir: 1 | -1 = -1) => (a: CoinMarket, b: CoinMarket) => dir * (((a[k] as number | null) ?? 0) - ((b[k] as number | null) ?? 0));

export const CATEGORIES: Record<string, { label: string; symbols: string[]; about: string }> = {
  stablecoins: { label: "Stablecoins", about: "tokens designed to hold a steady value, usually one US dollar", symbols: ["USDT", "USDC", "DAI", "USDS", "USDE", "FDUSD", "TUSD", "PYUSD", "USDD", "FRAX", "USD1", "RLUSD", "GHO", "LUSD", "CRVUSD", "USDP", "EURC"] },
  "layer-1": { label: "Layer 1 blockchains", about: "base-layer networks that settle their own transactions", symbols: ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "AVAX", "TRX", "TON", "DOT", "NEAR", "APT", "SUI", "ATOM", "ALGO", "ICP", "HBAR", "XLM", "LTC", "BCH", "ETC", "KAS", "SEI", "INJ", "EGLD", "XTZ", "S", "HYPE", "XMR", "VET", "FIL"] },
  "layer-2": { label: "Layer 2 & scaling", about: "networks that scale Ethereum or Bitcoin by settling back to them", symbols: ["ARB", "OP", "POL", "MATIC", "MNT", "IMX", "STRK", "ZK", "METIS", "STX", "SKL", "LRC", "BOBA"] },
  defi: { label: "DeFi tokens", about: "tokens of lending, exchange, derivatives and oracle protocols", symbols: ["UNI", "AAVE", "LINK", "MKR", "SKY", "LDO", "CRV", "COMP", "SNX", "JUP", "RAY", "PENDLE", "DYDX", "GMX", "1INCH", "CAKE", "SUSHI", "ENA", "ONDO", "MORPHO", "JTO", "RUNE", "BAL", "YFI"] },
  memecoins: { label: "Meme coins", about: "community and culture-driven tokens", symbols: ["DOGE", "SHIB", "PEPE", "BONK", "WIF", "FLOKI", "TRUMP", "BRETT", "POPCAT", "MEW", "FARTCOIN", "PNUT", "SPX", "BOME", "TURBO", "NEIRO", "MOG", "PENGU"] },
  "ai-tokens": { label: "AI tokens", about: "tokens of AI compute, data and agent networks", symbols: ["FET", "RENDER", "TAO", "WLD", "AGIX", "OCEAN", "AKT", "GRT", "VIRTUAL", "AI16Z", "ARKM", "IO", "AIOZ", "GLM", "NOS", "PRIME"] },
  "exchange-tokens": { label: "Exchange tokens", about: "tokens issued by centralized exchanges", symbols: ["BNB", "OKB", "CRO", "LEO", "KCS", "GT", "BGB", "HT", "MX", "WOO"] },
  privacy: { label: "Privacy coins", about: "coins focused on transaction privacy", symbols: ["XMR", "ZEC", "DASH", "DCR", "ROSE", "SCRT", "ARRR"] },
  gaming: { label: "Gaming & metaverse", about: "tokens of games, virtual worlds and their marketplaces", symbols: ["IMX", "SAND", "MANA", "AXS", "GALA", "APE", "BEAM", "ENJ", "ILV", "RON", "PIXEL", "YGG"] },
};

export function inCategory(slug: string, c: CoinMarket): boolean {
  return CATEGORIES[slug]?.symbols.includes(c.symbol.toUpperCase()) ?? false;
}

const rankings: Topic[] = [
  { slug: "top-gainers", kind: "ranking", label: "Top gainers", metric: "change24h", title: "Top crypto gainers today", queries: ["top crypto gainers today", "biggest crypto gainers 24h", "which crypto is up today"], blurb: "Coins with the largest 24-hour price increase, limited to assets with at least $1M daily volume and $10M market cap.", select: (cs) => cs.filter((c) => liquid(c) && (c.change24h ?? 0) > 0).sort(by("change24h")) },
  { slug: "top-losers", kind: "ranking", label: "Top losers", metric: "change24h", title: "Top crypto losers today", queries: ["top crypto losers today", "biggest crypto drops 24h", "which crypto is down today"], blurb: "Coins with the largest 24-hour price decline, limited to liquid assets.", select: (cs) => cs.filter((c) => liquid(c) && (c.change24h ?? 0) < 0).sort(by("change24h", 1)) },
  { slug: "weekly-gainers", kind: "ranking", label: "Weekly gainers", metric: "change7d", title: "Best performing crypto this week", queries: ["best crypto this week", "top weekly crypto gainers", "crypto up 7 days"], blurb: "Coins with the largest 7-day price increase among liquid assets.", select: (cs) => cs.filter((c) => liquid(c) && (c.change7d ?? 0) > 0).sort(by("change7d")) },
  { slug: "weekly-losers", kind: "ranking", label: "Weekly losers", metric: "change7d", title: "Worst performing crypto this week", queries: ["worst crypto this week", "crypto down 7 days"], blurb: "Coins with the largest 7-day price decline among liquid assets.", select: (cs) => cs.filter((c) => liquid(c) && (c.change7d ?? 0) < 0).sort(by("change7d", 1)) },
  { slug: "most-traded", kind: "ranking", label: "Most traded", metric: "volume24h", title: "Most traded cryptocurrencies today", queries: ["most traded crypto", "highest volume crypto today", "crypto trading volume ranking"], blurb: "Coins ranked by reported 24-hour trading volume across exchanges.", select: (cs) => cs.filter((c) => (c.volume24h ?? 0) > 0).sort(by("volume24h")) },
  { slug: "largest", kind: "ranking", label: "Largest by market cap", metric: "marketCap", title: "Largest cryptocurrencies by market cap", queries: ["top cryptocurrencies by market cap", "crypto market cap ranking", "biggest cryptocurrencies"], blurb: "Coins ranked by market capitalization (price × circulating supply).", select: (cs) => cs.filter((c) => (c.marketCap ?? 0) > 0).sort(by("marketCap")) },
];

const categories: Topic[] = Object.entries(CATEGORIES).map(([slug, c]) => ({
  slug, kind: "category" as const, label: c.label, metric: "marketCap" as const,
  title: `${c.label}: prices, market cap and 24h change`,
  queries: [`${c.label.toLowerCase()} prices`, `top ${c.label.toLowerCase()}`, `best ${c.label.toLowerCase()} by market cap`],
  blurb: `${c.label} — ${c.about} — ranked by market cap.`,
  select: (cs: CoinMarket[]) => cs.filter((x) => inCategory(slug, x) && (x.marketCap ?? 0) > 0).sort(by("marketCap")),
}));

const dex: Topic[] = [
  { slug: "trending-tokens", kind: "dex", label: "Trending tokens", title: "Trending crypto tokens on DEXs today", queries: ["trending crypto tokens", "trending tokens today", "hot new tokens"], blurb: "The most active on-chain pools across networks over the last 24 hours, from GeckoTerminal.", dex: { source: "trending" } },
  { slug: "new-tokens", kind: "dex", label: "New tokens", title: "New crypto tokens and pools", queries: ["new crypto tokens", "newly launched tokens", "new token listings"], blurb: "The newest liquidity pools created on decentralized exchanges. New tokens carry high risk — check contract and liquidity before trading.", dex: { source: "new" } },
  { slug: "solana-tokens", kind: "dex", label: "Solana tokens", title: "Top Solana tokens by trading volume", queries: ["top solana tokens", "solana meme coins", "best solana tokens"], blurb: "Solana pools ranked by 24-hour trading volume.", dex: { source: "top", network: "solana", chain: "solana" } },
  { slug: "ethereum-tokens", kind: "dex", label: "Ethereum tokens", title: "Top Ethereum tokens by DEX volume", queries: ["top ethereum tokens", "erc20 tokens by volume"], blurb: "Ethereum pools ranked by 24-hour trading volume.", dex: { source: "top", network: "eth", chain: "ethereum" } },
  { slug: "base-tokens", kind: "dex", label: "Base tokens", title: "Top Base tokens by trading volume", queries: ["top base tokens", "base chain meme coins"], blurb: "Base pools ranked by 24-hour trading volume.", dex: { source: "top", network: "base", chain: "base" } },
  { slug: "bnb-chain-tokens", kind: "dex", label: "BNB Chain tokens", title: "Top BNB Chain tokens by trading volume", queries: ["top bnb chain tokens", "bsc tokens by volume"], blurb: "BNB Chain pools ranked by 24-hour trading volume.", dex: { source: "top", network: "bsc", chain: "bsc" } },
];

export const TOPICS: Topic[] = [...rankings, ...categories, ...dex];
export const topicBySlug = (slug: string) => TOPICS.find((t) => t.slug === slug);

/** Categories a coin belongs to (for related links on its page). */
export const categoriesOf = (c: Pick<CoinMarket, "symbol">) =>
  Object.entries(CATEGORIES).filter(([, v]) => v.symbols.includes(c.symbol.toUpperCase())).map(([slug, v]) => ({ slug, label: v.label }));

/* ---- comparisons ---- */

export const pairSlug = (a: string, b: string) => `${a}-vs-${b}`;
export function parsePair(slug: string): [string, string] | null {
  const m = /^([a-z0-9-]{1,80})-vs-([a-z0-9-]{1,80})$/.exec(slug);
  return m && m[1] !== m[2] ? [m[1], m[2]] : null;
}

/**
 * Which comparisons to publish: every pair among the top coins by market cap,
 * plus each coin against its category peers. Stablecoins only vs each other.
 */
export function comparePairs(coins: CoinMarket[], top = 15): [CoinMarket, CoinMarket][] {
  const ranked = coins.filter((c) => (c.marketCap ?? 0) > 0).sort(by("marketCap"));
  const stable = (c: CoinMarket) => inCategory("stablecoins", c);
  const out = new Map<string, [CoinMarket, CoinMarket]>();
  const add = (a: CoinMarket, b: CoinMarket) => {
    if (a.id === b.id || stable(a) !== stable(b)) return;
    const [x, y] = (a.marketCap ?? 0) >= (b.marketCap ?? 0) ? [a, b] : [b, a];
    out.set(pairSlug(x.id, y.id), [x, y]);
  };
  const head = ranked.slice(0, top);
  head.forEach((a, i) => head.slice(i + 1).forEach((b) => add(a, b)));
  for (const slug of Object.keys(CATEGORIES)) {
    const peers = ranked.filter((c) => inCategory(slug, c)).slice(0, 6);
    peers.forEach((a, i) => peers.slice(i + 1).forEach((b) => add(a, b)));
  }
  return [...out.values()];
}

/** Pearson correlation of daily returns (null when too little data). */
export function correlation(a: number[], b: number[]): number | null {
  const ret = (s: number[]) => s.slice(1).map((v, i) => (s[i] ? v / s[i] - 1 : 0));
  const n = Math.min(a.length, b.length);
  if (n < 8) return null;
  const x = ret(a.slice(-n)), y = ret(b.slice(-n));
  const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

/** Annualised volatility of daily closes, in percent. */
export function volatility(closes: number[]): number | null {
  if (closes.length < 8) return null;
  const r = closes.slice(1).map((v, i) => Math.log(v / closes[i])).filter(Number.isFinite);
  const m = r.reduce((s, v) => s + v, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1));
  return sd * Math.sqrt(365) * 100;
}

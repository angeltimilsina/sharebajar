import "server-only";
import { cached } from "../server/cache";
import { fetchUpstream } from "../server/http";
import { toNum } from "../format";
import type { CoinMarket, GlobalStats } from "../types";

const SOURCE = "CoinGecko";
const KEY = process.env.COINGECKO_API_KEY;
const PRO = process.env.COINGECKO_PLAN === "pro";
const BASE = PRO ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
const headers: Record<string, string> = KEY ? { [PRO ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: KEY } : {};

const cg = <T>(path: string) => fetchUpstream<T>(`${BASE}${path}`, { headers, timeoutMs: 10_000 });

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeMarket(c: any): CoinMarket {
  return {
    id: c.id,
    symbol: String(c.symbol ?? "").toUpperCase(),
    name: c.name,
    image: c.image ?? null,
    rank: toNum(c.market_cap_rank),
    price: toNum(c.current_price),
    change1h: toNum(c.price_change_percentage_1h_in_currency),
    change24h: toNum(c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h),
    change7d: toNum(c.price_change_percentage_7d_in_currency),
    marketCap: toNum(c.market_cap),
    fdv: toNum(c.fully_diluted_valuation),
    volume24h: toNum(c.total_volume),
    circulatingSupply: toNum(c.circulating_supply),
    totalSupply: toNum(c.total_supply),
    maxSupply: toNum(c.max_supply),
    high24h: toNum(c.high_24h),
    low24h: toNum(c.low_24h),
    ath: toNum(c.ath),
    sparkline: Array.isArray(c.sparkline_in_7d?.price) ? c.sparkline_in_7d.price.filter((n: unknown) => typeof n === "number") : [],
    lastUpdated: c.last_updated ?? null,
  };
}

export interface MarketsQuery {
  category?: string;
  order?: "market_cap_desc" | "volume_desc";
  page?: number;
  perPage?: number;
  ids?: string[];
}

export function getMarkets(q: MarketsQuery = {}) {
  const params = new URLSearchParams({
    vs_currency: "usd",
    order: q.order ?? "market_cap_desc",
    per_page: String(Math.min(q.perPage ?? 100, 250)),
    page: String(q.page ?? 1),
    sparkline: "true",
    price_change_percentage: "1h,24h,7d",
  });
  if (q.category) params.set("category", q.category);
  if (q.ids?.length) params.set("ids", q.ids.join(","));
  const path = `/coins/markets?${params}`;
  return cached(`cg:${path}`, SOURCE, { ttlMs: 60_000, staleMs: 30 * 60_000 }, async () => {
    const raw = await cg<any[]>(path);
    return raw.map(normalizeMarket);
  });
}

export function getGlobal() {
  return cached("cg:global", SOURCE, { ttlMs: 120_000, staleMs: 60 * 60_000 }, async (): Promise<GlobalStats> => {
    const { data } = await cg<{ data: any }>("/global");
    return {
      totalMarketCap: data.total_market_cap?.usd ?? 0,
      totalVolume: data.total_volume?.usd ?? 0,
      marketCapChange24h: data.market_cap_change_percentage_24h_usd ?? 0,
      btcDominance: data.market_cap_percentage?.btc ?? 0,
      ethDominance: data.market_cap_percentage?.eth ?? 0,
      activeCryptocurrencies: data.active_cryptocurrencies ?? 0,
      markets: data.markets ?? 0,
      updatedAt: (data.updated_at ?? 0) * 1000,
    };
  });
}

export interface TrendingCoin {
  id: string; name: string; symbol: string; thumb: string | null; rank: number | null;
  price: number | null; change24h: number | null; marketCap: string | null; sparkline: string | null;
}

export function getTrendingCoins() {
  return cached("cg:trending", SOURCE, { ttlMs: 5 * 60_000, staleMs: 60 * 60_000 }, async (): Promise<TrendingCoin[]> => {
    const raw = await cg<{ coins: { item: any }[] }>("/search/trending");
    return raw.coins.map(({ item }) => ({
      id: item.id,
      name: item.name,
      symbol: String(item.symbol).toUpperCase(),
      thumb: item.small ?? item.thumb ?? null,
      rank: toNum(item.market_cap_rank),
      price: toNum(item.data?.price),
      change24h: toNum(item.data?.price_change_percentage_24h?.usd),
      marketCap: item.data?.market_cap ?? null,
      sparkline: item.data?.sparkline ?? null,
    }));
  });
}

export function searchCoins(query: string) {
  const q = query.trim().slice(0, 64);
  return cached(`cg:search:${q.toLowerCase()}`, SOURCE, { ttlMs: 10 * 60_000 }, async () => {
    const raw = await cg<{ coins: any[] }>(`/search?query=${encodeURIComponent(q)}`);
    return raw.coins.slice(0, 8).map((c) => ({
      id: c.id as string, name: c.name as string, symbol: String(c.symbol).toUpperCase(),
      thumb: (c.large ?? c.thumb ?? null) as string | null, rank: toNum(c.market_cap_rank),
    }));
  });
}

export interface CoinDetail {
  id: string;
  name: string;
  symbol: string;
  image: string | null;
  description: string;
  categories: string[];
  links: { homepage: string | null; twitter: string | null; reddit: string | null; github: string | null; explorers: string[] };
  /** chain slug (CoinGecko platform id) → contract address */
  platforms: Record<string, string>;
  genesisDate: string | null;
  market: CoinMarket;
  ath: number | null; athDate: string | null; atl: number | null; atlDate: string | null;
  sentimentUp: number | null;
  watchlistUsers: number | null;
}

export function getCoin(id: string) {
  const safe = encodeURIComponent(id.toLowerCase());
  return cached(`cg:coin:${safe}`, SOURCE, { ttlMs: 90_000, staleMs: 60 * 60_000 }, async (): Promise<CoinDetail> => {
    const c = await cg<any>(`/coins/${safe}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=true`);
    const m = c.market_data ?? {};
    const market = normalizeMarket({
      id: c.id, symbol: c.symbol, name: c.name, image: c.image?.large,
      market_cap_rank: c.market_cap_rank,
      current_price: m.current_price?.usd,
      price_change_percentage_1h_in_currency: m.price_change_percentage_1h_in_currency?.usd,
      price_change_percentage_24h_in_currency: m.price_change_percentage_24h_in_currency?.usd,
      price_change_percentage_7d_in_currency: m.price_change_percentage_7d_in_currency?.usd,
      market_cap: m.market_cap?.usd, fully_diluted_valuation: m.fully_diluted_valuation?.usd,
      total_volume: m.total_volume?.usd, circulating_supply: m.circulating_supply,
      total_supply: m.total_supply, max_supply: m.max_supply,
      high_24h: m.high_24h?.usd, low_24h: m.low_24h?.usd, ath: m.ath?.usd,
      sparkline_in_7d: m.sparkline_7d, last_updated: m.last_updated ?? c.last_updated,
    });
    const platforms: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.platforms ?? {})) if (k && typeof v === "string" && v) platforms[k] = v;
    return {
      id: c.id, name: c.name, symbol: String(c.symbol).toUpperCase(), image: c.image?.large ?? null,
      description: stripHtml(c.description?.en ?? "").slice(0, 1500),
      categories: (c.categories ?? []).filter(Boolean).slice(0, 6),
      links: {
        homepage: c.links?.homepage?.find((u: string) => u) ?? null,
        twitter: c.links?.twitter_screen_name ? `https://x.com/${c.links.twitter_screen_name}` : null,
        reddit: c.links?.subreddit_url || null,
        github: c.links?.repos_url?.github?.[0] ?? null,
        explorers: (c.links?.blockchain_site ?? []).filter(Boolean).slice(0, 4),
      },
      platforms,
      genesisDate: c.genesis_date ?? null,
      market,
      ath: toNum(m.ath?.usd), athDate: m.ath_date?.usd ?? null,
      atl: toNum(m.atl?.usd), atlDate: m.atl_date?.usd ?? null,
      sentimentUp: toNum(c.sentiment_votes_up_percentage),
      watchlistUsers: toNum(c.watchlist_portfolio_users),
    };
  });
}

/** Price history fallback for coins without a Binance pair: [[ms, price], ...] */
export function getCoinChart(id: string, days: string) {
  const safe = encodeURIComponent(id.toLowerCase());
  const d = ["1", "7", "30", "90", "365"].includes(days) ? days : "1";
  return cached(`cg:chart:${safe}:${d}`, SOURCE, { ttlMs: d === "1" ? 120_000 : 15 * 60_000 }, async () => {
    const raw = await cg<{ prices: [number, number][]; total_volumes: [number, number][] }>(`/coins/${safe}/market_chart?vs_currency=usd&days=${d}`);
    return raw.prices.map(([t, p], i) => ({ time: Math.floor(t / 1000), value: p, volume: raw.total_volumes[i]?.[1] ?? 0 }));
  });
}

/** CoinGecko platform ids → ShareBajar chain slugs */
export const CG_PLATFORM_TO_CHAIN: Record<string, string> = {
  solana: "solana", ethereum: "ethereum", base: "base", "binance-smart-chain": "bsc",
  "polygon-pos": "polygon", "arbitrum-one": "arbitrum", avalanche: "avalanche", "optimistic-ethereum": "optimism",
};

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, "").replace(/\r?\n\s*\r?\n/g, "\n\n").trim();
}

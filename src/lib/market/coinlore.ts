import "server-only";
import { cached } from "../server/cache";
import { fetchUpstream } from "../server/http";
import { toNum } from "../format";

/**
 * CoinLore public API — keyless, aggregated across exchanges.
 * Used for rankings, market caps, supply and global market stats.
 */
const SOURCE = "CoinLore";
const BASE = "https://api.coinlore.net/api";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface LoreCoin {
  id: string; // numeric CoinLore id
  slug: string; // nameid, used in ShareBajar URLs (/coin/bitcoin)
  symbol: string;
  name: string;
  rank: number;
  price: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  marketCap: number | null;
  volume24h: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
}

const norm = (c: any): LoreCoin => ({
  id: String(c.id),
  slug: c.nameid,
  symbol: String(c.symbol ?? "").toUpperCase(),
  name: c.name,
  rank: Number(c.rank),
  price: toNum(c.price_usd),
  change1h: toNum(c.percent_change_1h),
  change24h: toNum(c.percent_change_24h),
  change7d: toNum(c.percent_change_7d),
  marketCap: toNum(c.market_cap_usd),
  volume24h: toNum(c.volume24),
  circulatingSupply: toNum(c.csupply),
  totalSupply: toNum(c.tsupply),
  maxSupply: toNum(c.msupply),
});

/** Top `count` coins by market cap (CoinLore pages are 100 coins). */
export function getLoreCoins(count = 500) {
  return cached(`lore:tickers:${count}`, SOURCE, { ttlMs: 60_000, staleMs: 60 * 60_000 }, async () => {
    const pages = Math.ceil(count / 100);
    const results = await Promise.all(
      Array.from({ length: pages }, (_, i) => fetchUpstream<{ data: any[] }>(`${BASE}/tickers/?start=${i * 100}&limit=100`, { timeoutMs: 10_000 })),
    );
    const seen = new Set<string>();
    return results.flatMap((r) => r.data ?? []).map(norm).filter((c) => c.slug && !seen.has(c.slug) && (seen.add(c.slug), true));
  });
}

export interface LoreGlobal {
  totalMarketCap: number; totalVolume: number; marketCapChange24h: number; volumeChange24h: number;
  btcDominance: number; ethDominance: number; coins: number; markets: number;
}

export function getLoreGlobal() {
  return cached("lore:global", SOURCE, { ttlMs: 60_000, staleMs: 60 * 60_000 }, async (): Promise<LoreGlobal> => {
    const [g] = await fetchUpstream<any[]>(`${BASE}/global/`);
    return {
      totalMarketCap: Number(g.total_mcap), totalVolume: Number(g.total_volume),
      marketCapChange24h: Number(g.mcap_change), volumeChange24h: Number(g.volume_change),
      btcDominance: Number(g.btc_d), ethDominance: Number(g.eth_d),
      coins: Number(g.coins_count), markets: Number(g.active_markets),
    };
  });
}

export interface ExchangeMarket { exchange: string; pair: string; price: number; volumeUsd: number; time: number }

const USD_QUOTES = new Set(["USD", "USDT", "USDC", "FDUSD", "BUSD", "DAI", "USDE", "TUSD"]);

/**
 * Where a coin trades. CoinLore's list includes some broken conversions, so we
 * keep only USD-stablecoin pairs priced within 3% of the reference price.
 */
export function getExchangeMarkets(loreId: string, referencePrice: number | null) {
  return cached(`lore:markets:${loreId}`, SOURCE, { ttlMs: 5 * 60_000, staleMs: 60 * 60_000 }, async (): Promise<ExchangeMarket[]> => {
    const raw = await fetchUpstream<any[]>(`${BASE}/coin/markets/?id=${encodeURIComponent(loreId)}`, { timeoutMs: 10_000 });
    return (Array.isArray(raw) ? raw : [])
      .filter((m) => USD_QUOTES.has(String(m.quote).toUpperCase()))
      .map((m) => ({ exchange: m.name, pair: `${m.base}/${m.quote}`, price: Number(m.price_usd), volumeUsd: Number(m.volume_usd), time: Number(m.time) * 1000 }))
      .filter((m) => m.price > 0 && (!referencePrice || Math.abs(m.price - referencePrice) / referencePrice < 0.03))
      .sort((a, b) => b.volumeUsd - a.volumeUsd)
      .slice(0, 12);
  });
}

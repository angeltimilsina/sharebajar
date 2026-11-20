import "server-only";
import { after } from "next/server";
import { cached } from "../server/cache";
import { fetchUpstream } from "../server/http";
import { log } from "../server/log";
import { getExchangeMarkets, getLoreCoins, getLoreGlobal, type LoreCoin } from "./coinlore";
import { getUsdtSymbols } from "./binance";
import type { CoinMarket, Envelope, GlobalStats } from "../types";
import { tokenLogo } from "../logos";

/**
 * Keyless market data, merged from:
 *  - CoinLore: ranking, market cap, supply, 1h/7d change, reported volume
 *  - Binance: live price, 24h change/high/low and 7-day sparkline (where listed)
 * No API keys required.
 */
const BINANCE = process.env.BINANCE_REST_URL || "https://data-api.binance.vision";
// Self-hosted official logo when we have one; open icon CDN for the rest.
const ICON = (s: string) => tokenLogo(s) ?? `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${s.toLowerCase()}.png`;
export const coinIcon = ICON;

interface BnTicker { symbol: string; lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string; closeTime: number }

function getBinance24h(symbols: string[]) {
  const list = JSON.stringify([...symbols].sort());
  return cached(`bn:24hfull:${list}`, "Binance", { ttlMs: 15_000, staleMs: 10 * 60_000 }, () =>
    fetchUpstream<BnTicker[]>(`${BINANCE}/api/v3/ticker/24hr?symbols=${encodeURIComponent(list)}`, { timeoutMs: 10_000 }),
  );
}

/* ---- 7d sparklines from Binance 4h candles, filled in the background ---- */
const g = globalThis as unknown as { __sbSpark?: Map<string, { at: number; data: number[] }>; __sbSparkBusy?: boolean };
const sparks = (g.__sbSpark ??= new Map());

function refreshSparklines(pairs: string[]) {
  if (g.__sbSparkBusy) return;
  const stale = pairs.filter((p) => !sparks.has(p) || Date.now() - sparks.get(p)!.at > 30 * 60_000);
  if (!stale.length) return;
  g.__sbSparkBusy = true;
  const job = () => (async () => {
    for (let i = 0; i < stale.length; i += 8) {
      await Promise.all(stale.slice(i, i + 8).map(async (p) => {
        try {
          const k = await fetchUpstream<(string | number)[][]>(`${BINANCE}/api/v3/klines?symbol=${p}&interval=4h&limit=42`, { retries: 0 });
          sparks.set(p, { at: Date.now(), data: k.map((r) => Number(r[4])) });
        } catch { /* try again next cycle */ }
      }));
    }
  })().catch((e) => log("warn", "sparkline refresh failed", { error: String(e) })).finally(() => { g.__sbSparkBusy = false; });
  // On serverless hosts (Vercel) work must be registered with after() or it is
  // frozen once the response is sent. Outside a request scope, just run it.
  try { after(job); } catch { void job(); }
}

/**
 * Do two quotes describe the same asset? Within 5%, or — for sub-$0.001
 * prices, which the ranking source rounds to one significant digit — within
 * that rounding (e.g. 0.000003 vs 0.00000273).
 */
export function pricesAgree(a: number, b: number): boolean {
  const ref = Math.max(a, b);
  let tol = 0.05 * ref;
  if (ref < 0.001) tol = Math.max(tol, 0.5 * 10 ** Math.floor(Math.log10(ref)));
  return Math.abs(a - b) <= tol;
}

function merge(c: LoreCoin, pair: string | undefined, t: BnTicker | undefined): CoinMarket {
  const bnPrice = t ? Number(t.lastPrice) : null;
  // Only trust the Binance pair when it agrees with the aggregate price (guards symbol collisions).
  const live = bnPrice && c.price && pricesAgree(bnPrice, c.price) ? t : undefined;
  const price = live ? Number(live.lastPrice) : c.price;
  return {
    id: c.slug,
    symbol: c.symbol,
    name: c.name,
    image: ICON(c.symbol),
    rank: c.rank,
    price,
    change1h: c.change1h,
    change24h: live ? Number(live.priceChangePercent) : c.change24h,
    change7d: c.change7d,
    marketCap: price && c.circulatingSupply ? price * c.circulatingSupply : c.marketCap,
    fdv: price && (c.maxSupply || c.totalSupply) ? price * (c.maxSupply || c.totalSupply || 0) : null,
    volume24h: c.volume24h,
    circulatingSupply: c.circulatingSupply,
    totalSupply: c.totalSupply,
    maxSupply: c.maxSupply,
    high24h: live ? Number(live.highPrice) : null,
    low24h: live ? Number(live.lowPrice) : null,
    ath: null,
    sparkline: pair && live ? sparks.get(pair)?.data ?? [] : [],
    lastUpdated: live ? new Date(live.closeTime).toISOString() : null,
  };
}

export interface MarketsQuery { ids?: string[]; order?: "market_cap_desc" | "volume_desc"; perPage?: number }

export async function getMarkets(q: MarketsQuery = {}): Promise<Envelope<CoinMarket[]>> {
  const lore = await getLoreCoins(500);
  let coins = lore.data;
  if (q.ids?.length) {
    const want = new Set(q.ids);
    coins = coins.filter((c) => want.has(c.slug));
  } else {
    if (q.order === "volume_desc") coins = [...coins].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
    coins = coins.slice(0, Math.min(q.perPage ?? 100, 250));
  }
  let symbols: Record<string, string> = {};
  try { symbols = (await getUsdtSymbols()).data; } catch { /* Binance optional */ }
  const pairs = [...new Set(coins.map((c) => symbols[c.symbol]).filter(Boolean))];
  let tickers = new Map<string, BnTicker>();
  let bnFetched: number | null = null;
  if (pairs.length) {
    try {
      const env = await getBinance24h(pairs);
      tickers = new Map(env.data.map((t) => [t.symbol, t]));
      bnFetched = env.fetchedAt;
    } catch (e) { log("warn", "binance overlay unavailable", { error: String(e) }); }
    refreshSparklines(pairs.slice(0, 120));
  }
  const data = coins.map((c) => merge(c, symbols[c.symbol], tickers.get(symbols[c.symbol])));
  return { data, source: bnFetched ? "CoinLore + Binance" : "CoinLore", fetchedAt: Math.max(lore.fetchedAt, bnFetched ?? 0), stale: lore.stale };
}

export async function getGlobal(): Promise<Envelope<GlobalStats>> {
  const env = await getLoreGlobal();
  const d = env.data;
  return {
    ...env,
    data: {
      totalMarketCap: d.totalMarketCap, totalVolume: d.totalVolume, marketCapChange24h: d.marketCapChange24h,
      btcDominance: d.btcDominance, ethDominance: d.ethDominance, activeCryptocurrencies: d.coins, markets: d.markets, updatedAt: env.fetchedAt,
    },
  };
}

export async function searchCoins(query: string) {
  const q = query.trim().toLowerCase();
  const { data } = await getLoreCoins(500);
  const scored = data
    .map((c) => {
      const s = c.symbol.toLowerCase(), n = c.name.toLowerCase();
      const score = s === q ? 0 : n === q ? 1 : s.startsWith(q) ? 2 : n.startsWith(q) ? 3 : n.includes(q) ? 4 : -1;
      return { c, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.c.rank - b.c.rank)
    .slice(0, 8);
  return { data: scored.map(({ c }) => ({ id: c.slug, name: c.name, symbol: c.symbol, thumb: ICON(c.symbol), rank: c.rank })) };
}

export interface CoinDetail {
  market: CoinMarket;
  loreId: string;
  binancePair: string | null;
  ath: { price: number; time: number } | null;
  atl: { price: number; time: number } | null;
  exchanges: { exchange: string; pair: string; price: number; volumeUsd: number; time: number }[];
}

/** Everything the coin page needs, from keyless sources. Returns null if unknown. */
export async function getCoinDetail(slug: string): Promise<{ data: CoinDetail; fetchedAt: number; stale: boolean } | null> {
  const lore = await getLoreCoins(500);
  const c = lore.data.find((x) => x.slug === slug);
  if (!c) return null;
  const env = await getMarkets({ ids: [slug] });
  const market = env.data[0];
  let pair: string | null = null;
  try { pair = (await getUsdtSymbols()).data[c.symbol] ?? null; } catch { /* optional */ }
  if (pair && market.high24h === null) pair = null; // Binance pair failed the price-agreement check
  const [extremes, exchanges] = await Promise.allSettled([
    pair ? getAllTimeRange(pair) : Promise.resolve(null),
    getExchangeMarkets(c.id, market.price),
  ]);
  return {
    data: {
      market, loreId: c.id, binancePair: pair,
      ath: extremes.status === "fulfilled" && extremes.value ? extremes.value.ath : null,
      atl: extremes.status === "fulfilled" && extremes.value ? extremes.value.atl : null,
      exchanges: exchanges.status === "fulfilled" ? exchanges.value.data : [],
    },
    fetchedAt: env.fetchedAt,
    stale: env.stale,
  };
}

/** High/low since the pair was listed on Binance (weekly candles). */
function getAllTimeRange(pair: string) {
  return cached(`bn:atr:${pair}`, "Binance", { ttlMs: 3600_000, staleMs: 24 * 3600_000 }, async () => {
    const k = await fetchUpstream<(string | number)[][]>(`${BINANCE}/api/v3/klines?symbol=${pair}&interval=1w&limit=1000`);
    if (!k.length) return null;
    let hi = k[0], lo = k[0];
    for (const r of k) { if (Number(r[2]) > Number(hi[2])) hi = r; if (Number(r[3]) < Number(lo[3])) lo = r; }
    return { ath: { price: Number(hi[2]), time: Number(hi[0]) }, atl: { price: Number(lo[3]), time: Number(lo[0]) } };
  }).then((e) => e.data);
}

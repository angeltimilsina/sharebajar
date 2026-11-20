import "server-only";
import { cached } from "../server/cache";
import { fetchUpstream } from "../server/http";
import type { Candle } from "../types";

const SOURCE = "Binance";
// api.binance.com is geo-restricted in some regions; the market-data mirror is not.
const BASE = process.env.BINANCE_REST_URL || "https://data-api.binance.vision";

export const BINANCE_INTERVALS = ["1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w"] as const;
export type BinanceInterval = (typeof BINANCE_INTERVALS)[number];

/** Binance kline row → Candle (includes taker-buy volume for buyer/seller ratio). */
export function klineToCandle(k: (string | number)[]): Candle {
  return {
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]),
    volume: Number(k[5]),
    trades: Number(k[8]),
    buyVolume: Number(k[9]),
  };
}

export function getKlines(symbol: string, interval: BinanceInterval, limit = 500, endTime?: number) {
  const params = new URLSearchParams({ symbol, interval, limit: String(Math.min(limit, 1000)) });
  if (endTime) params.set("endTime", String(endTime));
  const ttl = interval === "1s" ? 1000 : interval === "1m" ? 5000 : 20_000;
  return cached(`bn:klines:${params}`, SOURCE, { ttlMs: ttl, staleMs: 5 * 60_000 }, async () => {
    const raw = await fetchUpstream<(string | number)[][]>(`${BASE}/api/v3/klines?${params}`);
    return raw.map(klineToCandle);
  });
}

/** Set of base assets that have an active USDT spot pair. */
export function getUsdtSymbols() {
  return cached("bn:usdt-symbols", SOURCE, { ttlMs: 6 * 3600_000, staleMs: 48 * 3600_000 }, async () => {
    const raw = await fetchUpstream<{ symbols: { symbol: string; baseAsset: string; quoteAsset: string; status: string }[] }>(
      `${BASE}/api/v3/exchangeInfo?permissions=SPOT`, { timeoutMs: 15_000 },
    );
    const map: Record<string, string> = {};
    for (const s of raw.symbols) if (s.quoteAsset === "USDT" && s.status === "TRADING") map[s.baseAsset] = s.symbol;
    return map;
  });
}

export async function binanceSymbolFor(baseSymbol: string): Promise<string | null> {
  try {
    const { data } = await getUsdtSymbols();
    return data[baseSymbol.toUpperCase()] ?? null;
  } catch {
    return null;
  }
}

export function get24hTickers(symbols: string[]) {
  const list = JSON.stringify(symbols);
  return cached(`bn:24h:${list}`, SOURCE, { ttlMs: 10_000 }, async () => {
    const raw = await fetchUpstream<{ symbol: string; lastPrice: string; openPrice: string; quoteVolume: string }[]>(
      `${BASE}/api/v3/ticker/24hr?type=MINI&symbols=${encodeURIComponent(list)}`,
    );
    return raw.map((t) => {
      const last = Number(t.lastPrice), open = Number(t.openPrice);
      return { symbol: t.symbol, price: last, change24h: open ? ((last - open) / open) * 100 : 0, quoteVolume: Number(t.quoteVolume) };
    });
  });
}

export function getDepth(symbol: string, limit = 20) {
  return cached(`bn:depth:${symbol}:${limit}`, SOURCE, { ttlMs: 1000, staleMs: 30_000 }, async () => {
    const raw = await fetchUpstream<{ lastUpdateId: number; bids: [string, string][]; asks: [string, string][] }>(
      `${BASE}/api/v3/depth?symbol=${symbol}&limit=${limit}`,
    );
    return { bids: raw.bids.map(([p, q]) => [Number(p), Number(q)]), asks: raw.asks.map(([p, q]) => [Number(p), Number(q)]) };
  });
}

export const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;

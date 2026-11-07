import type { Candle, Trade } from "../types";

export const RESOLUTION_SECONDS: Record<string, number> = {
  "1s": 1, "5s": 5, "15s": 15, "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
};

export const bucketStart = (tSec: number, intervalSec: number) => Math.floor(tSec / intervalSec) * intervalSec;

/** Aggregate fine candles (e.g. 1s) into a coarser interval (e.g. 5s). */
export function aggregateCandles(candles: Candle[], intervalSec: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const t = bucketStart(c.time, intervalSec);
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
      if (c.buyVolume !== undefined) last.buyVolume = (last.buyVolume ?? 0) + c.buyVolume;
      if (c.trades !== undefined) last.trades = (last.trades ?? 0) + c.trades;
    } else {
      out.push({ ...c, time: t });
    }
  }
  return out;
}

/**
 * Merge one live candle update into a series (in place semantics, returns new
 * array). Updates the last bar if same bucket, appends if newer.
 */
export function upsertCandle(series: Candle[], c: Candle, intervalSec: number, maxBars = 2000): Candle[] {
  const t = bucketStart(c.time, intervalSec);
  const last = series[series.length - 1];
  if (!last || t > last.time) {
    const next = [...series, { ...c, time: t }];
    return next.length > maxBars ? next.slice(next.length - maxBars) : next;
  }
  if (t === last.time) {
    const copy = series.slice();
    copy[copy.length - 1] = { ...c, time: t };
    return copy;
  }
  return series; // out-of-order update older than the last bar: ignore
}

/**
 * Given the full fine-grained series (e.g. 1s), build the aggregated bar for
 * the bucket containing the latest fine candle and upsert it into `series`.
 */
export function rollLatest(fine: Candle[], series: Candle[], intervalSec: number, maxBars = 2000): Candle[] {
  const latest = fine[fine.length - 1];
  if (!latest) return series;
  const bucket = bucketStart(latest.time, intervalSec);
  let i = fine.length - 1;
  while (i > 0 && fine[i - 1].time >= bucket) i--;
  const bar = aggregateCandles(fine.slice(i), intervalSec)[0];
  return upsertCandle(series, bar, intervalSec, maxBars);
}

/** Fold trades (any order) into candles at `intervalSec`. Prices in USD. */
export function candlesFromTrades(trades: Trade[], intervalSec: number): Candle[] {
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  const out: Candle[] = [];
  for (const tr of sorted) {
    if (!(tr.price > 0)) continue;
    const t = bucketStart(Math.floor(tr.time / 1000), intervalSec);
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, tr.price);
      last.low = Math.min(last.low, tr.price);
      last.close = tr.price;
      last.volume += tr.notional;
      if (tr.side === "buy") last.buyVolume = (last.buyVolume ?? 0) + tr.notional;
      last.trades = (last.trades ?? 0) + 1;
    } else {
      out.push({
        time: t, open: last ? last.close : tr.price, high: Math.max(tr.price, last?.close ?? tr.price),
        low: Math.min(tr.price, last?.close ?? tr.price), close: tr.price, volume: tr.notional,
        buyVolume: tr.side === "buy" ? tr.notional : 0, trades: 1,
      });
    }
  }
  return out;
}

/** Merge newly seen trades into existing trade list (dedupe by id), newest first. */
export function mergeTrades(existing: Trade[], incoming: Trade[], max = 500): Trade[] {
  const seen = new Set(existing.map((t) => t.id));
  const fresh = incoming.filter((t) => !seen.has(t.id));
  if (!fresh.length) return existing;
  return [...fresh, ...existing].sort((a, b) => b.time - a.time).slice(0, max);
}

/** Apply a single trade to a candle series (used for live DEX candles ≥1m). */
export function applyTrade(series: Candle[], tr: Trade, intervalSec: number, maxBars = 2000): Candle[] {
  if (!(tr.price > 0)) return series;
  const t = bucketStart(Math.floor(tr.time / 1000), intervalSec);
  const last = series[series.length - 1];
  if (last && t < last.time) return series;
  if (last && t === last.time) {
    const copy = series.slice();
    copy[copy.length - 1] = {
      ...last, high: Math.max(last.high, tr.price), low: Math.min(last.low, tr.price), close: tr.price,
      volume: last.volume + tr.notional, buyVolume: (last.buyVolume ?? 0) + (tr.side === "buy" ? tr.notional : 0), trades: (last.trades ?? 0) + 1,
    };
    return copy;
  }
  const open = last ? last.close : tr.price;
  const next = [...series, { time: t, open, high: Math.max(open, tr.price), low: Math.min(open, tr.price), close: tr.price, volume: tr.notional, buyVolume: tr.side === "buy" ? tr.notional : 0, trades: 1 }];
  return next.length > maxBars ? next.slice(next.length - maxBars) : next;
}

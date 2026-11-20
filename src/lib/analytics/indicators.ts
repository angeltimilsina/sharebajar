import type { Candle } from "../types";

/** Output point: null where the indicator is not yet defined (warm-up). */
export interface Point { time: number; value: number | null }

const pts = (candles: Candle[], values: (number | null)[]): Point[] => candles.map((c, i) => ({ time: c.time, value: values[i] ?? null }));

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => (f[i] !== null && s[i] !== null ? (f[i] as number) - (s[i] as number) : null));
  const firstIdx = line.findIndex((v) => v !== null);
  const sig: (number | null)[] = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const tail = ema(line.slice(firstIdx) as number[], signal);
    tail.forEach((v, j) => (sig[firstIdx + j] = v));
  }
  const hist = line.map((v, i) => (v !== null && sig[i] !== null ? v - (sig[i] as number) : null));
  return { line, signal: sig, hist };
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i] as number;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j] - m) ** 2;
    const sd = Math.sqrt(v / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

/** Anchored VWAP over the visible series (typical price × volume). */
export function vwap(candles: Candle[]): (number | null)[] {
  let pv = 0, vol = 0;
  return candles.map((c) => {
    pv += ((c.high + c.low + c.close) / 3) * c.volume;
    vol += c.volume;
    return vol > 0 ? pv / vol : null;
  });
}

/** Rate of change (%), Bajar "momentum". */
export function momentum(values: number[], period = 10): (number | null)[] {
  return values.map((v, i) => (i >= period && values[i - period] !== 0 ? ((v - values[i - period]) / values[i - period]) * 100 : null));
}

/**
 * Buyer/seller ratio per candle: taker-buy volume ÷ total volume (0–1),
 * smoothed. 0.5 = balanced, >0.5 = buyers in control.
 */
export function buyerSellerRatio(candles: Candle[], smooth = 5): (number | null)[] {
  const raw = candles.map((c) => (c.buyVolume !== undefined && c.volume > 0 ? c.buyVolume / c.volume : null));
  const out: (number | null)[] = new Array(raw.length).fill(null);
  for (let i = 0; i < raw.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - smooth + 1); j <= i; j++) if (raw[j] !== null) { s += raw[j] as number; n++; }
    out[i] = n ? s / n : null;
  }
  return out;
}

export interface ProfileBucket { priceLow: number; priceHigh: number; volume: number; buyVolume: number }

/** Volume-by-price histogram across `buckets` price levels. */
export function volumeProfile(candles: Candle[], buckets = 24): ProfileBucket[] {
  if (!candles.length) return [];
  const lo = Math.min(...candles.map((c) => c.low));
  const hi = Math.max(...candles.map((c) => c.high));
  if (!(hi > lo)) return [];
  const step = (hi - lo) / buckets;
  const out: ProfileBucket[] = Array.from({ length: buckets }, (_, i) => ({ priceLow: lo + i * step, priceHigh: lo + (i + 1) * step, volume: 0, buyVolume: 0 }));
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((tp - lo) / step)));
    out[idx].volume += c.volume;
    out[idx].buyVolume += c.buyVolume ?? 0;
  }
  return out;
}

export const closes = (c: Candle[]) => c.map((x) => x.close);
export const asPoints = pts;

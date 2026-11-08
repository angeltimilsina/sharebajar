import { describe, expect, it } from "vitest";
import { bollinger, buyerSellerRatio, ema, macd, momentum, rsi, sma, volumeProfile, vwap } from "@/lib/analytics/indicators";
import type { Candle } from "@/lib/types";

const c = (close: number, i: number, extra: Partial<Candle> = {}): Candle => ({ time: i, open: close, high: close + 1, low: close - 1, close, volume: 10, ...extra });

describe("moving averages", () => {
  it("sma warms up then averages", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("ema seeds with sma and tracks", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(3);
    expect(out[4]).toBeCloseTo(4);
  });
});

describe("rsi", () => {
  it("is 100 on a pure uptrend and 0 on a pure downtrend", () => {
    const up = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(rsi(up).at(-1)).toBe(100);
    const down = [...up].reverse();
    expect(rsi(down).at(-1)).toBeCloseTo(0);
  });
  it("matches a reference value", () => {
    // Classic Wilder example series (first RSI ≈ 70.53)
    const s = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(s, 14)[14]).toBeCloseTo(70.46, 0);
  });
});

describe("macd / bollinger / vwap / momentum", () => {
  it("macd histogram = line - signal", () => {
    const v = Array.from({ length: 60 }, (_, i) => Math.sin(i / 5) * 10 + 100);
    const m = macd(v);
    const i = 59;
    expect(m.hist[i]).toBeCloseTo((m.line[i] as number) - (m.signal[i] as number));
    expect(m.signal.slice(0, 33).every((x) => x === null)).toBe(true);
  });
  it("bollinger collapses on flat data", () => {
    const b = bollinger(Array(25).fill(5), 20, 2);
    expect(b.upper[24]).toBe(5);
    expect(b.lower[24]).toBe(5);
  });
  it("vwap weights by volume", () => {
    const cs = [c(10, 0, { high: 10, low: 10, volume: 1 }), c(20, 1, { high: 20, low: 20, volume: 3 })];
    expect(vwap(cs)[1]).toBeCloseTo(17.5);
  });
  it("momentum is rate of change", () => {
    expect(momentum([100, 110], 1)[1]).toBeCloseTo(10);
  });
});

describe("Bajar indicators", () => {
  it("buyer/seller ratio uses taker-buy share", () => {
    const cs = [c(1, 0, { volume: 10, buyVolume: 8 }), c(1, 1, { volume: 10, buyVolume: 2 })];
    expect(buyerSellerRatio(cs, 1)).toEqual([0.8, 0.2]);
    expect(buyerSellerRatio(cs, 2)[1]).toBeCloseTo(0.5);
  });
  it("volume profile sums all volume into buckets", () => {
    const cs = Array.from({ length: 20 }, (_, i) => c(100 + i, i));
    const vp = volumeProfile(cs, 10);
    expect(vp).toHaveLength(10);
    expect(vp.reduce((s, b) => s + b.volume, 0)).toBe(200);
  });
});

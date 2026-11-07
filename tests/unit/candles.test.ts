import { describe, expect, it } from "vitest";
import { aggregateCandles, applyTrade, candlesFromTrades, mergeTrades, rollLatest, upsertCandle } from "@/lib/analytics/candles";
import type { Candle, Trade } from "@/lib/types";

const k = (time: number, o: number, h: number, l: number, cl: number, v = 1): Candle => ({ time, open: o, high: h, low: l, close: cl, volume: v, buyVolume: v / 2 });
const tr = (id: string, sec: number, price: number, side: "buy" | "sell" = "buy", usd = 100): Trade => ({ id, time: sec * 1000, side, price, amount: usd / price, notional: usd });

describe("aggregateCandles", () => {
  it("builds 5s bars from 1s klines", () => {
    const fine = [k(100, 1, 2, 1, 2), k(101, 2, 3, 2, 3), k(104, 3, 3, 1, 1), k(105, 1, 5, 1, 4)];
    const out = aggregateCandles(fine, 5);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ time: 100, open: 1, high: 3, low: 1, close: 1, volume: 3, buyVolume: 1.5 });
    expect(out[1]).toMatchObject({ time: 105, open: 1, close: 4 });
  });
});

describe("live candle formation", () => {
  it("upsert updates the forming bar and appends new ones", () => {
    let s = [k(60, 1, 1, 1, 1)];
    s = upsertCandle(s, k(60, 1, 2, 1, 2), 60);
    expect(s).toHaveLength(1);
    expect(s[0].close).toBe(2);
    s = upsertCandle(s, k(120, 2, 2, 2, 2), 60);
    expect(s).toHaveLength(2);
    s = upsertCandle(s, k(30, 9, 9, 9, 9), 60); // stale update ignored
    expect(s.map((x) => x.time)).toEqual([60, 120]);
  });
  it("rollLatest re-aggregates the current bucket from 1s data", () => {
    const fine = [k(100, 1, 1, 1, 1), k(101, 1, 4, 1, 3), k(102, 3, 3, 0.5, 2)];
    const series = rollLatest(fine, aggregateCandles(fine.slice(0, 1), 5), 5);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ open: 1, high: 4, low: 0.5, close: 2, volume: 3 });
  });
});

describe("trades → candles", () => {
  it("folds trades into OHLCV with buy volume", () => {
    const out = candlesFromTrades([tr("b", 101, 11, "sell", 50), tr("a", 100, 10), tr("c", 106, 12)], 5);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ time: 100, open: 10, high: 11, low: 10, close: 11, volume: 150, buyVolume: 100, trades: 2 });
    expect(out[1].open).toBe(11); // gap-free: opens at previous close
  });
  it("applyTrade extends the series in real time", () => {
    let s = candlesFromTrades([tr("a", 61, 10)], 60);
    s = applyTrade(s, tr("b", 110, 12), 60);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ high: 12, close: 12 });
    s = applyTrade(s, tr("c", 185, 9, "sell"), 60);
    expect(s).toHaveLength(2);
    expect(s[1]).toMatchObject({ time: 180, open: 12, low: 9, close: 9 });
  });
  it("mergeTrades dedupes by id and keeps newest first", () => {
    const merged = mergeTrades([tr("a", 100, 1)], [tr("a", 100, 1), tr("b", 101, 1)]);
    expect(merged.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

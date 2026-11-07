import { describe, expect, it } from "vitest";
import { buySellSummary, largeTradeThreshold, poolSignals } from "@/lib/analytics/signals";
import { scoreEvm, scoreSolana } from "@/lib/security/risk";
import { applyFilters, EMPTY_FILTERS } from "@/lib/analytics/filters";
import type { Pool, Trade } from "@/lib/types";

const pool = (over: Partial<Pool> = {}): Pool => ({
  id: "p", network: "solana", address: "x", name: "A / SOL", dex: "raydium",
  base: { address: "a", symbol: "A", name: "A", image: null }, quote: { address: "q", symbol: "SOL" },
  priceUsd: 1, fdv: 1e6, marketCap: 1e6, reserveUsd: 100_000,
  change: { m5: 0, h1: 0, h6: 0, h24: 0 }, volume: { m5: 0, h1: 1000, h6: 0, h24: 50_000 },
  txns: { h1: { buys: 5, sells: 5 }, h24: { buys: 50, sells: 50 } }, createdAt: Date.now() - 30 * 86400_000, ...over,
});

describe("poolSignals", () => {
  it("flags turnover, buy pressure, thin liquidity and fresh pools", () => {
    const s = poolSignals(pool({ reserveUsd: 5_000, volume: { m5: 0, h1: 0, h6: 0, h24: 100_000 }, txns: { h1: { buys: 40, sells: 5 }, h24: { buys: 0, sells: 0 } }, createdAt: Date.now() - 3600_000 }));
    const kinds = s.map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(["volume-spike", "buy-pressure", "thin-liquidity", "fresh-pool"]));
  });
  it("stays quiet for a normal pool", () => expect(poolSignals(pool())).toEqual([]));
});

describe("trade analytics", () => {
  const trades: Trade[] = Array.from({ length: 100 }, (_, i) => ({ id: String(i), time: i, side: i % 2 ? "buy" : "sell", price: 1, amount: i, notional: i * 100 }));
  it("large-trade threshold is p95 with a floor", () => {
    expect(largeTradeThreshold(trades, 1000)).toBe(9500);
    expect(largeTradeThreshold(trades.slice(0, 5), 1000)).toBe(1000);
  });
  it("summarises buy/sell flow", () => {
    const s = buySellSummary(trades);
    expect(s.buys).toBe(50);
    expect(s.buyRatio).toBeGreaterThan(0.5);
  });
});

describe("risk scoring", () => {
  it("scores a clean EVM token as low risk", () => {
    const r = scoreEvm({ is_honeypot: "0", is_open_source: "1", is_proxy: "0", is_mintable: "0", buy_tax: "0", sell_tax: "0", trust_list: "1", holders: [{ address: "0x1", percent: "0.05", is_contract: 0, is_locked: 0 }] });
    expect(r.level).toBe("low");
    expect(r.trusted).toBe(true);
    expect(r.flags.find((f) => f.key === "honeypot")?.ok).toBe(true);
  });
  it("scores a honeypot with high taxes as high risk", () => {
    const r = scoreEvm({ is_honeypot: "1", is_open_source: "0", sell_tax: "0.5", buy_tax: "0.05", hidden_owner: "1" });
    expect(r.level).toBe("high");
    expect(r.sellTax).toBeCloseTo(50);
    expect(r.flags[0].ok).toBe(false);
  });
  it("reads Solana authorities", () => {
    const safe = scoreSolana({ mintable: { status: "0" }, freezable: { status: "0" }, holders: [] });
    expect(safe.flags.find((f) => f.key === "mintable")).toMatchObject({ ok: true, detail: "Renounced" });
    const risky = scoreSolana({ mintable: { status: "1" }, freezable: { status: "1" }, holders: [{ account: "a", percent: "0.7" }] });
    expect(risky.level).toBe("high");
    expect(risky.top10Pct).toBeCloseTo(70);
  });
});

describe("discovery filters", () => {
  it("filters by liquidity, age and change", () => {
    const now = Date.now();
    const pools = [pool({ id: "old", reserveUsd: 50_000 }), pool({ id: "new", reserveUsd: 5_000, createdAt: now - 3600_000, change: { m5: 0, h1: 0, h6: 0, h24: 80 } })];
    expect(applyFilters(pools, { ...EMPTY_FILTERS, minLiq: "10000" }, now).map((p) => p.id)).toEqual(["old"]);
    expect(applyFilters(pools, { ...EMPTY_FILTERS, maxAgeH: "24" }, now).map((p) => p.id)).toEqual(["new"]);
    expect(applyFilters(pools, { ...EMPTY_FILTERS, minChange: "50" }, now).map((p) => p.id)).toEqual(["new"]);
    expect(applyFilters(pools, { ...EMPTY_FILTERS, hideThin: true }, now).map((p) => p.id)).toEqual(["old"]);
  });
});

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chainLogo, exchangeLogo, tokenLogo, walletLogo } from "@/lib/logos";
import { metadataV3Data, validateLaunch } from "@/lib/launch/solanaToken";
import { CATEGORIES, TOPICS, comparePairs, correlation, pairSlug, parsePair, topicBySlug, volatility } from "@/lib/seo/topics";
import { groundedIn, numbersIn } from "@/lib/seo/agent";
import type { CoinMarket } from "@/lib/types";

const pub = (p: string) => existsSync(join(process.cwd(), "public", p));

describe("logos", () => {
  it("resolves canonical tokens, aliases, chains and wallets to files that exist", () => {
    for (const s of ["BTC", "ETH", "SOL", "USDC", "USDT"]) expect(pub(tokenLogo(s)!)).toBe(true);
    expect(tokenLogo("WETH")).toBe(tokenLogo("ETH"));
    expect(tokenLogo("$sol")).toBe(tokenLogo("SOL"));
    for (const c of ["ethereum", "solana", "base", "bsc", "polygon", "arbitrum"]) expect(pub(chainLogo(c)!)).toBe(true);
    expect(pub(walletLogo("io.metamask")!)).toBe(true);
    expect(exchangeLogo("Binance")).toMatch(/^\/logos\/exchanges\//);
  });
  it("never invents a logo for unknown tickers", () => {
    expect(tokenLogo("NOTAREALTOKENXYZ")).toBeNull();
    expect(tokenLogo("")).toBeNull();
  });
});

describe("token launch validation", () => {
  const ok = { name: "Bajar Test", symbol: "BJT", uri: "https://sharebajar.com/api/launch/metadata/x", decimals: 6, supply: BigInt(1_000_000_000) };
  it("accepts a valid launch", () => expect(validateLaunch(ok)).toBeNull());
  it("rejects bad name, symbol, uri, decimals and supply", () => {
    expect(validateLaunch({ ...ok, name: " " })).toMatch(/Name/);
    expect(validateLaunch({ ...ok, name: "x".repeat(33) })).toMatch(/Name/);
    expect(validateLaunch({ ...ok, symbol: "TOOLONGSYMB" })).toMatch(/Symbol/);
    expect(validateLaunch({ ...ok, uri: "http://insecure.example" })).toMatch(/URI/);
    expect(validateLaunch({ ...ok, decimals: 10 })).toMatch(/Decimals/);
    expect(validateLaunch({ ...ok, supply: BigInt(0) })).toMatch(/Supply/);
    expect(validateLaunch({ ...ok, decimals: 9, supply: BigInt("100000000000") })).toMatch(/u64/);
  });
  it("encodes Metaplex CreateMetadataAccountV3 data", () => {
    const d = metadataV3Data("Ab", "C", "u", false);
    expect(d[0]).toBe(33);
    expect(d.readUInt32LE(1)).toBe(2);
    expect(d.subarray(5, 7).toString()).toBe("Ab");
    expect(d[d.length - 2]).toBe(0); // is_mutable = false
  });
});

const coin = (id: string, symbol: string, mc: number, vol: number, ch24: number, ch7 = 0): CoinMarket => ({
  id, symbol, name: id, image: "", rank: null, price: 1, change1h: 0, change24h: ch24, change7d: ch7, marketCap: mc, fdv: null,
  volume24h: vol, circulatingSupply: mc, totalSupply: null, maxSupply: null, high24h: null, low24h: null, ath: null, sparkline: [], lastUpdated: null,
} as CoinMarket);

describe("seo topics", () => {
  const coins = [
    coin("bitcoin", "BTC", 2e12, 3e10, 1.5, 4), coin("ethereum", "ETH", 4e11, 2e10, -2, -5), coin("tether", "USDT", 1.5e11, 5e10, 0.01),
    coin("usd-coin", "USDC", 6e10, 8e9, 0), coin("dogecoin", "DOGE", 3e10, 2e9, 9, 20), coin("pepe", "PEPE", 5e9, 1e9, -7, -12),
    coin("tiny", "TINY", 1e6, 1e4, 300),
  ];
  it("has unique slugs and every category is a topic", () => {
    const slugs = TOPICS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const k of Object.keys(CATEGORIES)) expect(topicBySlug(k)?.kind).toBe("category");
  });
  it("gainers/losers sort correctly and exclude illiquid coins", () => {
    const g = topicBySlug("top-gainers")!.select!(coins).map((c) => c.symbol);
    expect(g[0]).toBe("DOGE");
    expect(g).not.toContain("TINY");
    expect(topicBySlug("top-losers")!.select!(coins)[0].symbol).toBe("PEPE");
    expect(topicBySlug("largest")!.select!(coins)[0].symbol).toBe("BTC");
    expect(topicBySlug("memecoins")!.select!(coins).map((c) => c.symbol)).toEqual(["DOGE", "PEPE"]);
  });
  it("comparisons are ordered by market cap and never mix stablecoins with volatile coins", () => {
    const pairs = comparePairs(coins);
    for (const [a, b] of pairs) {
      expect(a.marketCap! >= b.marketCap!).toBe(true);
      expect(CATEGORIES.stablecoins.symbols.includes(a.symbol)).toBe(CATEGORIES.stablecoins.symbols.includes(b.symbol));
    }
    expect(pairs.some(([a, b]) => a.id === "bitcoin" && b.id === "ethereum")).toBe(true);
    expect(parsePair(pairSlug("bitcoin", "ethereum"))).toEqual(["bitcoin", "ethereum"]);
    expect(parsePair("bitcoin-vs-bitcoin")).toBeNull();
    expect(parsePair("../etc")).toBeNull();
  });
  it("correlation and volatility behave", () => {
    const a = Array.from({ length: 30 }, (_, i) => 100 + i + (i % 3));
    expect(correlation(a, a)).toBeCloseTo(1, 6);
    expect(correlation(a, a.map((v) => 1000 - v))!).toBeLessThan(0);
    expect(correlation([1, 2], [1, 2])).toBeNull();
    expect(volatility(Array(30).fill(10))).toBe(0);
  });
});

describe("AI intro grounding", () => {
  const facts = "Bitcoin price $67,234.10, 24h +2.15%, market cap $1.33T";
  it("extracts numbers", () => expect(numbersIn(facts)).toEqual(["67234.10".replace(/\.0+$/, ""), "24", "2.15", "1.33"]));
  it("accepts text whose numbers are all in the facts", () => expect(groundedIn("Bitcoin trades near $67,234.10, up 2.15% in 24 hours.", facts)).toBe(true));
  it("rejects invented figures", () => expect(groundedIn("Bitcoin could reach $100,000 soon.", facts)).toBe(false));
});

import { allocation, assetHref, dayChange, walletInsights, type InsightHolding } from "@/lib/bajar/insights";

describe("wallet insights", () => {
  const h = (o: Partial<InsightHolding>): InsightHolding => ({ network: "solana", networkName: "Solana", token: "t", symbol: "X", amount: 1, usdValue: 10, usdPrice: 10, native: false, change24h: null, ...o });
  it("asks to back up and to fund an empty wallet", () => {
    const ids = walletInsights([], { backedUp: false, loaded: true }).map((i) => i.id);
    expect(ids).toEqual(["backup", "fund"]);
  });
  it("flags tokens with no fee token on their network", () => {
    const ins = walletInsights([h({ network: "base", networkName: "Base", symbol: "USDC", usdValue: 50 })], { backedUp: true, loaded: true });
    expect(ins.find((i) => i.id === "gas:base")?.title).toBe("No ETH for fees on Base");
    const ok = walletInsights([h({ network: "base", networkName: "Base", symbol: "USDC", usdValue: 50 }), h({ network: "base", symbol: "ETH", native: true, amount: 0.01 })], { backedUp: true, loaded: true });
    expect(ok.some((i) => i.id === "gas:base")).toBe(false);
  });
  it("reports concentration, mover, wrapped BTC and unpriced tokens", () => {
    const hs = [h({ symbol: "SOL", native: true, usdValue: 900, change24h: -5 }), h({ symbol: "USDC", usdValue: 100, change24h: 0 }), h({ network: "ethereum", networkName: "Ethereum", symbol: "WBTC", wrappedBtc: true, usdValue: 0, usdPrice: null })];
    const ids = walletInsights(hs, { backedUp: true, loaded: true }).map((i) => i.id);
    for (const id of ["mover", "concentration", "stables", "wrapped", "unpriced"]) expect(ids).toContain(id);
  });
  it("computes day change and allocation", () => {
    const d = dayChange([h({ usdValue: 110, change24h: 10 }), h({ usdValue: 100, change24h: null })]);
    expect(d.usd).toBeCloseTo(10, 6);
    expect(d.pct).toBeCloseTo(10, 6);
    expect(d.coverage).toBeCloseTo(110 / 210, 6);
    const a = allocation([h({ symbol: "ETH", network: "ethereum", usdValue: 30 }), h({ symbol: "ETH", network: "base", usdValue: 30 }), h({ symbol: "SOL", usdValue: 40 })], "asset");
    expect(a.map((s) => [s.key, Math.round(s.pct)])).toEqual([["ETH", 60], ["SOL", 40]]);
  });
  it("links holdings to their asset pages", () => {
    expect(assetHref({ network: "bitcoin", token: "BTC", symbol: "BTC", native: true })).toBe("/coin/bitcoin");
    expect(assetHref({ network: "base", token: "0xabc", symbol: "USDC", native: false })).toBe("/token/base/0xabc");
    expect(assetHref({ network: "bsc", token: "0x0", symbol: "BNB", native: true })).toBeNull();
  });
});

import { applyLens, coinRow, coinSignals, lensSource, statFor } from "@/lib/market/board";

describe("market board", () => {
  const mk = (id: string, o: Partial<CoinMarket>) => coin(id, id.toUpperCase(), o.marketCap ?? 1e9, o.volume24h ?? 5e6, o.change24h ?? 0, o.change7d ?? 0);
  it("picks the right data source per lens and network", () => {
    expect(lensSource("top", "all")).toEqual({ kind: "coins" });
    expect(lensSource("top", "solana")).toEqual({ kind: "pools", feed: "top" });
    expect(lensSource("new", "all")).toEqual({ kind: "pools", feed: "new" });
    expect(lensSource("watchlist", "base")).toEqual({ kind: "watchlist" });
  });
  it("gainers follow the selected timeframe and skip illiquid coins", () => {
    const rows = [mk("a", { change24h: 5, change7d: 1 }), mk("b", { change24h: 1, change7d: 30 }), { ...mk("c", { change24h: 50 }), volume24h: 10 } as CoinMarket].map((c) => coinRow(c));
    expect(applyLens(rows, "gainers", "change24h").map((r) => r.symbol)).toEqual(["A", "B"]);
    expect(applyLens(rows, "gainers", "change7d").map((r) => r.symbol)).toEqual(["B", "A"]);
    expect(applyLens(rows, "gainers", "volume").map((r) => r.symbol)).toEqual(["A", "B"]); // non-change stat → 24h
  });
  it("falls back to 24h when a stat doesn't apply", () => {
    expect(statFor([coinRow(mk("a", {}))], "liquidity")).toBe("change24h");
    expect(statFor([coinRow(mk("a", {}))], "marketCap")).toBe("marketCap");
  });
  it("signals come only from the data", () => {
    expect(coinSignals({ ...mk("a", { change24h: 6, change7d: -15 }), change1h: 0 } as CoinMarket).map((s) => s.label)).toContain("Rebounding");
    expect(coinSignals({ ...mk("a", {}), volume24h: 5e8, marketCap: 1e9 } as CoinMarket).map((s) => s.label)).toContain("Heavy volume");
    expect(coinSignals(mk("a", {}))).toEqual([]);
  });
});

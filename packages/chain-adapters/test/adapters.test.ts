import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CHAINS, addressKind, chainById, createAdapter, dedupeByToken, isAddress, InvalidAddressError,
  parseOhlcv, parsePairs, parsePools, parseRisk, parseTrades, type FetchJson,
} from "@bajar/chain-adapters";

/** Real provider responses captured from the live APIs (trimmed to a few items). */
const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8"));

describe("chain registry", () => {
  it("has phase-1 Solana and Base, plus Arbitrum, each with every provider id", () => {
    expect(CHAINS.filter((c) => c.phase === 1).map((c) => c.id)).toEqual(["solana", "base"]);
    expect(chainById("arbitrum")?.evmChainId).toBe(42161);
    for (const c of CHAINS) expect(Object.values(c.providers).every(Boolean)).toBe(true);
  });
  it("validates addresses per chain kind", () => {
    const sol = chainById("solana")!, base = chainById("base")!;
    expect(isAddress(sol, "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")).toBe(true);
    expect(isAddress(base, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBe(true);
    expect(isAddress(base, "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")).toBe(false);
    expect(addressKind("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBe("evm");
    expect(addressKind("hello")).toBeNull();
  });
});

describe("GeckoTerminal parsing", () => {
  for (const chain of ["solana", "base"]) {
    it(`normalizes ${chain} trending pools with resolved tokens and the chain id`, () => {
      const pools = parsePools(fx(`gt-trending-${chain}`));
      expect(pools.length).toBeGreaterThan(0);
      for (const p of pools) {
        expect(p.chain).toBe(chain);
        expect(p.address).toBeTruthy();
        expect(p.base.address).toBeTruthy();
        expect(p.base.symbol).toBeTruthy();
        expect(p.dex).toBeTruthy();
        expect(p.source).toBe("GeckoTerminal");
        expect(p.priceUsd === null || p.priceUsd > 0).toBe(true);
      }
    });
    it(`turns ${chain} OHLCV into ascending, finite candles`, () => {
      const c = parseOhlcv(fx(`gt-ohlcv-${chain}`));
      expect(c.length).toBeGreaterThan(0);
      for (let i = 1; i < c.length; i++) expect(c[i].time).toBeGreaterThan(c[i - 1].time);
      for (const k of c) expect(k.high).toBeGreaterThanOrEqual(k.low);
    });
    it(`normalizes ${chain} trades with side and time`, () => {
      const t = parseTrades(fx(`gt-trades-${chain}`));
      expect(t.length).toBeGreaterThan(0);
      for (const x of t) { expect(["buy", "sell"]).toContain(x.side); expect(x.txHash).toBeTruthy(); expect(Number.isFinite(x.time)).toBe(true); }
    });
  }
  it("never invents values: missing fields stay null", () => {
    const [p] = parsePools({ data: [{ id: "solana_X", attributes: { address: "X", name: "A / B" }, relationships: {} }] });
    expect(p.priceUsd).toBeNull();
    expect(p.liquidityUsd).toBeNull();
    expect(p.volumeUsd.h24).toBeNull();
    expect(p.txns.h24).toBeNull();
    expect(p.base.symbol).toBe("A");
  });
});

describe("DexScreener parsing", () => {
  it("keeps only supported chains and maps liquidity", () => {
    const pools = [...parsePairs(fx("ds-search-x-0")), ...parsePairs(fx("ds-search-x-1"))];
    expect(pools.length).toBeGreaterThan(0);
    for (const p of pools) expect(chainById(p.chain)).toBeTruthy();
    expect(parsePairs({ pairs: [{ chainId: "unknown-chain", pairAddress: "x" }] })).toEqual([]);
  });
  it("dedupes to one row per token, keeping the deepest pool", () => {
    const mk = (addr: string, liq: number) => ({ ...parsePools({ data: [{ id: "base_" + addr, attributes: { address: addr, name: "T / ETH", reserve_in_usd: liq }, relationships: { base_token: { data: { id: "base_0xabc" } } } }] })[0] });
    const out = dedupeByToken([mk("0x1", 10), mk("0x2", 500), mk("0x3", 50)]);
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe("0x2");
  });
});

describe("GoPlus risk", () => {
  it("scores real Solana and EVM responses", () => {
    const sol = parseRisk(chainById("solana")!, "x", Object.values(fx("gp-solana-solana").result)[0]);
    const evm = parseRisk(chainById("base")!, "0x", Object.values(fx("gp-evm-base").result)[0]);
    for (const r of [sol, evm]) { expect(["low", "medium", "high"]).toContain(r.level); expect(r.source).toBe("GoPlus Security"); }
    expect(evm.holders.top10Pct).not.toBeNull();
  });
  it("flags a honeypot as high risk and unknown when the provider has no data", () => {
    const r = parseRisk(chainById("base")!, "0x", { is_honeypot: "1", buy_tax: "0", sell_tax: "0.99", holders: [] });
    expect(r.level).toBe("high");
    expect(r.honeypot).toBe(true);
    expect(r.sellTaxPct).toBeCloseTo(99);
    expect(parseRisk(chainById("base")!, "0x", null).level).toBe("unknown");
  });
});

describe("adapter", () => {
  const replay: FetchJson = async <T,>(url: string) => {
    const name = url.includes("trending_pools") ? "gt-trending-solana" : url.includes("/ohlcv/") ? "gt-ohlcv-solana" : url.includes("/trades") ? "gt-trades-solana"
      : url.includes("/info") ? "gt-token-info-solana" : url.includes("/pools") ? "gt-token-pools-solana" : url.includes("/tokens/") ? "gt-token-solana" : null;
    if (!name) throw new Error(`unexpected ${url}`);
    return fx(name) as T;
  };
  const sol = createAdapter(chainById("solana")!, { fetchJson: replay });

  it("rejects invalid addresses before any network call", async () => {
    await expect(sol.token("0xnot-a-solana-address")).rejects.toBeInstanceOf(InvalidAddressError);
    await expect(sol.ohlcv("../../etc/passwd", "1h")).rejects.toBeInstanceOf(InvalidAddressError);
  });
  it("aggregates a token profile from its pools", async () => {
    const pool = parsePools(fx("gt-token-pools-solana"))[0];
    const t = await sol.token(pool.base.address);
    expect(t).not.toBeNull();
    expect(t!.chain).toBe("solana");
    expect(t!.topPool).toBeTruthy();
    expect(t!.poolCount).toBeGreaterThan(0);
  });
  it("serves candles and trades through the adapter", async () => {
    const pool = parsePools(fx("gt-trending-solana"))[0];
    expect((await sol.ohlcv(pool.address, "1h")).length).toBeGreaterThan(0);
    expect((await sol.trades(pool.address)).length).toBeGreaterThan(0);
  });
});

describe("token pools", () => {
  it("uses pools where the token is the base, not pools that quote it", async () => {
    const TOKEN = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    const pair = (base: string, quote: string, liq: number, addr: string) => ({ chainId: "solana", pairAddress: addr, dexId: "orca", baseToken: { address: base, symbol: "B", name: "B" }, quoteToken: { address: quote, symbol: "Q", name: "Q" }, liquidity: { usd: liq } });
    const fetchJson: FetchJson = async <T,>(url: string) => {
      if (url.includes("geckoterminal")) throw new Error("429");
      return [pair("pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", TOKEN, 5_000_000, "P1"), pair(TOKEN, "So11111111111111111111111111111111111111112", 2_000_000, "P2")] as T;
    };
    const pools = await createAdapter(chainById("solana")!, { fetchJson }).tokenPools(TOKEN);
    expect(pools.map((p) => p.address)).toEqual(["P2"]);
  });
});

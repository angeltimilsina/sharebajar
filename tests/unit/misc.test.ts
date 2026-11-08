import { describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import bs58 from "bs58";
import { parseRss, filterNews } from "@/lib/news/rss";
import { detectAddress, getChain, isValidAddressFor } from "@/lib/chains";
import { cached, __clearCache } from "@/lib/server/cache";
import { UpstreamError } from "@/lib/server/http";
import { recoverEvmAddress, seal, signInMessage, unseal, verifySolana } from "@/lib/server/auth";
import { coinInsights } from "@/lib/analytics/insights";
import { normalizePair } from "@/lib/market/dexscreener";
import { normalizePools } from "@/lib/market/geckoterminal";

describe("RSS parsing", () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Bitcoin holds above $96K &amp; rising]]></title><link>https://example.com/a</link>
      <pubDate>Wed, 15 Jan 2025 14:20:00 GMT</pubDate><description>&lt;p&gt;Institutional inflows&lt;/p&gt;</description>
      <media:content url="https://img.example.com/a.jpg" medium="image"/></item>
    <item><title>No link item</title></item>
    <item><title>Solana memecoins surge</title><link>https://example.com/b</link><description>SOL activity</description></item>
  </channel></rss>`;
  it("extracts items with titles, links, dates and images", () => {
    const items = parseRss(xml, "Test");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Bitcoin holds above $96K & rising", url: "https://example.com/a", image: "https://img.example.com/a.jpg", summary: "Institutional inflows" });
    expect(items[0].publishedAt).toBe(Date.parse("2025-01-15T14:20:00Z"));
  });
  it("filters by keywords", () => {
    expect(filterNews(parseRss(xml, "T"), ["Solana", "SOL"]).map((n) => n.url)).toEqual(["https://example.com/b"]);
  });
});

describe("chains", () => {
  it("detects address types", () => {
    expect(detectAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7")?.chainType).toBe("evm");
    expect(detectAddress("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")?.chainType).toBe("solana");
    expect(detectAddress("bonk")).toBeNull();
  });
  it("validates per chain", () => {
    expect(isValidAddressFor(getChain("solana")!, "0xdAC17F958D2ee523a2206206994597C13D831ec7")).toBe(false);
    expect(isValidAddressFor(getChain("base")!, "0xdAC17F958D2ee523a2206206994597C13D831ec7")).toBe(true);
  });
});

describe("cache", () => {
  it("dedupes concurrent fetches and serves stale data on upstream failure", async () => {
    __clearCache();
    const fetcher = vi.fn().mockResolvedValue(42);
    const [a, b] = await Promise.all([cached("k", "Src", { ttlMs: 0 }, fetcher), cached("k", "Src", { ttlMs: 0 }, fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.data).toBe(42);
    expect(b.stale).toBe(false);
    const failing = vi.fn().mockRejectedValue(new UpstreamError("down", 503, "api.example.com"));
    const c = await cached("k", "Src", { ttlMs: 0, staleMs: 60_000 }, failing);
    expect(c).toMatchObject({ data: 42, stale: true });
    expect(c.error).toContain("api.example.com");
  });
  it("throws when there is nothing cached", async () => {
    __clearCache();
    await expect(cached("x", "Src", { ttlMs: 0 }, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});

describe("wallet sign-in", () => {
  const msg = signInMessage("solana", "addr", "abc123", "2026-01-01T00:00:00Z", "sharebajar.app");
  it("builds a readable message with no transaction", () => {
    expect(msg).toContain("will not trigger a blockchain transaction");
    expect(msg).toContain("Nonce: abc123");
  });
  it("verifies Solana ed25519 signatures", () => {
    const priv = ed25519.utils.randomPrivateKey();
    const pub = bs58.encode(ed25519.getPublicKey(priv));
    const sig = bs58.encode(ed25519.sign(new TextEncoder().encode(msg), priv));
    expect(verifySolana(msg, sig, pub)).toBe(true);
    expect(verifySolana(msg + "x", sig, pub)).toBe(false);
  });
  it("recovers EVM personal_sign addresses", () => {
    const priv = secp256k1.utils.randomPrivateKey();
    const pub = secp256k1.getPublicKey(priv, false);
    const addr = `0x${Buffer.from(keccak_256(pub.subarray(1)).subarray(-20)).toString("hex")}`;
    const m = new TextEncoder().encode(msg);
    const prefixed = new Uint8Array([...new TextEncoder().encode(`\x19Ethereum Signed Message:\n${m.length}`), ...m]);
    const s = secp256k1.sign(keccak_256(prefixed), priv);
    const hex = `0x${s.toCompactHex()}${(s.recovery! + 27).toString(16)}`;
    expect(recoverEvmAddress(msg, hex)).toBe(addr);
  });
  it("seals and rejects tampered or expired sessions", () => {
    const t = seal({ a: 1, exp: Date.now() + 1000 }, "session");
    expect(unseal<{ a: number }>(t, "session")?.a).toBe(1);
    expect(unseal(t.slice(0, -2) + "xx", "session")).toBeNull();
    expect(unseal(seal({ exp: Date.now() - 1 }, "session"), "session")).toBeNull();
  });
  it("never accepts a sign-in challenge token as a session (purpose binding)", () => {
    const challenge = seal({ address: "victim", chainType: "solana", exp: Date.now() + 60_000 }, "nonce");
    expect(unseal(challenge, "session")).toBeNull();
    expect(unseal(challenge, "nonce")).not.toBeNull();
  });
});

describe("normalizers", () => {
  it("normalizes DexScreener pairs", () => {
    const p = normalizePair({ chainId: "bsc", dexId: "pancakeswap", pairAddress: "0xp", baseToken: { address: "0xb", name: "B", symbol: "B" }, quoteToken: { address: "0xq", name: "Q", symbol: "Q" }, priceUsd: "1.5", liquidity: { usd: 1000 }, txns: { h24: { buys: 3, sells: 1 } }, volume: { h24: 99 } });
    expect(p).toMatchObject({ chain: "bsc", priceUsd: 1.5, liquidityUsd: 1000, txns: { h24: { buys: 3, sells: 1 }, m5: { buys: 0, sells: 0 } } });
  });
  it("normalizes GeckoTerminal pools with included tokens", () => {
    const [p] = normalizePools({
      data: [{ id: "eth_0xpool", attributes: { address: "0xpool", name: "PEPE / WETH", base_token_price_usd: "0.00001", reserve_in_usd: "5000", pool_created_at: "2026-01-01T00:00:00Z", price_change_percentage: { h24: "12.5" }, volume_usd: { h24: "100" }, transactions: { h24: { buys: 1, sells: 2 } } },
        relationships: { base_token: { data: { id: "eth_0xpepe" } }, quote_token: { data: { id: "eth_0xweth" } }, dex: { data: { id: "uniswap_v3" } } } }],
      included: [{ id: "eth_0xpepe", attributes: { address: "0xpepe", symbol: "PEPE", name: "Pepe", image_url: "missing.png" } }, { id: "uniswap_v3", attributes: { name: "Uniswap V3" } }],
    });
    expect(p).toMatchObject({ network: "ethereum", dex: "Uniswap V3", base: { symbol: "PEPE", image: null }, quote: { address: "0xweth", symbol: "WETH" }, reserveUsd: 5000, change: { h24: 12.5 } });
  });
});

describe("insights", () => {
  it("produces plain-language observations", () => {
    const ins = coinInsights({ id: "x", symbol: "X", name: "X", image: null, rank: 1, price: 50, change1h: 0, change24h: 2, change7d: -5, marketCap: 1000, fdv: 3000, volume24h: 500, circulatingSupply: null, totalSupply: null, maxSupply: null, high24h: 60, low24h: 40, ath: 100, sparkline: [], lastUpdated: null });
    const text = ins.map((i) => i.text).join(" ");
    expect(text).toContain("50.0% below its all-time high");
    expect(text).toContain("unusually heavy turnover");
    expect(text).toContain("3.0× market cap");
  });
});

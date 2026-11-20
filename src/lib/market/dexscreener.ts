import "server-only";
import { cached } from "../server/cache";
import { fetchUpstream } from "../server/http";
import { toNum } from "../format";
import { chainFromDexscreener } from "../chains";
import type { DexPair } from "../types";

const SOURCE = "DexScreener";
const BASE = "https://api.dexscreener.com";

/* eslint-disable @typescript-eslint/no-explicit-any */
const tx = (t: any) => ({ buys: Number(t?.buys ?? 0), sells: Number(t?.sells ?? 0) });

export function normalizePair(p: any): DexPair {
  const chain = chainFromDexscreener(p.chainId)?.id ?? p.chainId;
  return {
    chain,
    dex: p.dexId ?? "unknown",
    pairAddress: p.pairAddress,
    url: p.url ?? "",
    base: { address: p.baseToken?.address ?? "", name: p.baseToken?.name ?? "", symbol: p.baseToken?.symbol ?? "" },
    quote: { address: p.quoteToken?.address ?? "", name: p.quoteToken?.name ?? "", symbol: p.quoteToken?.symbol ?? "" },
    priceUsd: toNum(p.priceUsd),
    priceNative: toNum(p.priceNative),
    change: { m5: toNum(p.priceChange?.m5), h1: toNum(p.priceChange?.h1), h6: toNum(p.priceChange?.h6), h24: toNum(p.priceChange?.h24) },
    volume: { m5: toNum(p.volume?.m5), h1: toNum(p.volume?.h1), h6: toNum(p.volume?.h6), h24: toNum(p.volume?.h24) },
    txns: { m5: tx(p.txns?.m5), h1: tx(p.txns?.h1), h6: tx(p.txns?.h6), h24: tx(p.txns?.h24) },
    liquidityUsd: toNum(p.liquidity?.usd),
    fdv: toNum(p.fdv),
    marketCap: toNum(p.marketCap),
    createdAt: toNum(p.pairCreatedAt),
    imageUrl: p.info?.imageUrl ?? null,
    websites: (p.info?.websites ?? []).map((w: any) => ({ label: w.label ?? "Website", url: w.url })),
    socials: (p.info?.socials ?? []).map((s: any) => ({ type: s.type, url: s.url })),
    labels: p.labels ?? [],
  };
}

export function searchPairs(query: string) {
  const q = query.trim().slice(0, 100);
  return cached(`ds:search:${q.toLowerCase()}`, SOURCE, { ttlMs: 30_000 }, async () => {
    const raw = await fetchUpstream<{ pairs: any[] | null }>(`${BASE}/latest/dex/search?q=${encodeURIComponent(q)}`);
    return (raw.pairs ?? []).map(normalizePair);
  });
}

/** All pairs for a token on a chain, sorted by liquidity (deepest first). */
export function getTokenPairs(dsChain: string, address: string) {
  return cached(`ds:token:${dsChain}:${address}`, SOURCE, { ttlMs: 15_000, staleMs: 10 * 60_000 }, async () => {
    const raw = await fetchUpstream<any[]>(`${BASE}/token-pairs/v1/${encodeURIComponent(dsChain)}/${encodeURIComponent(address)}`);
    return (Array.isArray(raw) ? raw : []).map(normalizePair)
      // keep pools where this token is the base asset (quote-side pools invert the price)
      .filter((p) => p.base.address.toLowerCase() === address.toLowerCase()).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  });
}

/** Look up pairs for any address without knowing the chain. */
export function getPairsByAddress(address: string) {
  return cached(`ds:addr:${address}`, SOURCE, { ttlMs: 30_000 }, async () => {
    const raw = await fetchUpstream<{ pairs: any[] | null }>(`${BASE}/latest/dex/tokens/${encodeURIComponent(address)}`);
    return (raw.pairs ?? []).map(normalizePair).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  });
}

export interface TokenProfile {
  chain: string;
  address: string;
  icon: string | null;
  description: string | null;
  links: { type?: string; label?: string; url: string }[];
  boostAmount?: number;
}

const profile = (p: any): TokenProfile => ({
  chain: chainFromDexscreener(p.chainId)?.id ?? p.chainId,
  address: p.tokenAddress,
  icon: typeof p.icon === "string" && p.icon.startsWith("http") ? p.icon : null,
  description: p.description ?? null,
  links: p.links ?? [],
  boostAmount: toNum(p.totalAmount ?? p.amount) ?? undefined,
});

export function getLatestProfiles() {
  return cached("ds:profiles", SOURCE, { ttlMs: 30_000 }, async () => {
    const raw = await fetchUpstream<any[]>(`${BASE}/token-profiles/latest/v1`);
    return raw.map(profile);
  });
}

export function getTopBoosts() {
  return cached("ds:boosts", SOURCE, { ttlMs: 60_000 }, async () => {
    const raw = await fetchUpstream<any[]>(`${BASE}/token-boosts/top/v1`);
    return raw.map(profile);
  });
}

/** Batch market data for up to 30 token addresses on one chain. */
export function getTokensBatch(dsChain: string, addresses: string[]) {
  const list = addresses.slice(0, 30).join(",");
  return cached(`ds:batch:${dsChain}:${list}`, SOURCE, { ttlMs: 30_000 }, async () => {
    const raw = await fetchUpstream<any[]>(`${BASE}/tokens/v1/${encodeURIComponent(dsChain)}/${list}`);
    // keep deepest pair per base token
    const best = new Map<string, DexPair>();
    for (const p of (Array.isArray(raw) ? raw : []).map(normalizePair)) {
      const cur = best.get(p.base.address);
      if (!cur || (p.liquidityUsd ?? 0) > (cur.liquidityUsd ?? 0)) best.set(p.base.address, p);
    }
    return [...best.values()];
  });
}

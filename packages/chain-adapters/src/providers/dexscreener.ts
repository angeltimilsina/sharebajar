import type { FetchJson, PoolSummary } from "../types.ts";
import { chainByDexscreener } from "../chains.ts";
import { num } from "./geckoterminal.ts";

/** DexScreener: cross-chain search and pair lookup (no key; ≈300 calls/min). */
export const DS_SOURCE = "DexScreener";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Raw DexScreener pairs → unified pools, keeping only chains Bajar supports. Pure. */
export function parsePairs(raw: { pairs?: any[] | null } | any[] | null): PoolSummary[] {
  const list: any[] = Array.isArray(raw) ? raw : raw?.pairs ?? [];
  const out: PoolSummary[] = [];
  for (const p of list) {
    const chain = chainByDexscreener(String(p?.chainId ?? ""));
    if (!chain) continue;
    const bs = (w: any) => (w ? { buys: Number(w.buys ?? 0), sells: Number(w.sells ?? 0) } : null);
    out.push({
      chain: chain.id,
      address: String(p.pairAddress ?? ""),
      dex: String(p.dexId ?? "unknown"),
      name: `${p.baseToken?.symbol ?? "?"} / ${p.quoteToken?.symbol ?? "?"}`,
      base: { address: String(p.baseToken?.address ?? ""), symbol: String(p.baseToken?.symbol ?? ""), name: String(p.baseToken?.name ?? ""), image: p.info?.imageUrl ?? null },
      quote: { address: String(p.quoteToken?.address ?? ""), symbol: String(p.quoteToken?.symbol ?? ""), name: String(p.quoteToken?.name ?? ""), image: null },
      priceUsd: num(p.priceUsd),
      liquidityUsd: num(p.liquidity?.usd),
      fdvUsd: num(p.fdv),
      marketCapUsd: num(p.marketCap),
      volumeUsd: { m5: num(p.volume?.m5), h1: num(p.volume?.h1), h6: num(p.volume?.h6), h24: num(p.volume?.h24) },
      priceChangePct: { m5: num(p.priceChange?.m5), h1: num(p.priceChange?.h1), h6: num(p.priceChange?.h6), h24: num(p.priceChange?.h24) },
      txns: { h1: bs(p.txns?.h1), h24: bs(p.txns?.h24) },
      createdAt: num(p.pairCreatedAt),
      source: DS_SOURCE,
    });
  }
  return out;
}

export function dexScreener(fetchJson: FetchJson) {
  return {
    search: async (q: string) => parsePairs(await fetchJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`)),
    tokenPairs: async (dsChain: string, address: string) => parsePairs(await fetchJson(`https://api.dexscreener.com/token-pairs/v1/${dsChain}/${address}`)),
  };
}

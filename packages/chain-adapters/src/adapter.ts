import type { ChainAdapter, ChainConfig, FetchJson, PoolSummary, TokenSummary } from "./types.ts";
import { CHAINS, chainById, isAddress, normalizeAddress } from "./chains.ts";
import { geckoTerminal, type GtOptions } from "./providers/geckoterminal.ts";
import { dexScreener } from "./providers/dexscreener.ts";
import { goPlus } from "./providers/goplus.ts";

export interface AdapterOptions { fetchJson: FetchJson; geckoTerminal?: GtOptions }

export class InvalidAddressError extends Error {
  constructor(chain: ChainConfig, address: string) { super(`Not a valid ${chain.name} address: ${address.slice(0, 64)}`); this.name = "InvalidAddressError"; }
}

/** Deepest pool first: where a token's price, chart and trades are read from. */
export const byLiquidity = (a: PoolSummary, b: PoolSummary) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0);

/** One row per token across pools (keeps the deepest pool). */
export function dedupeByToken(pools: PoolSummary[]): PoolSummary[] {
  const best = new Map<string, PoolSummary>();
  for (const p of pools) {
    const k = `${p.chain}:${p.base.address.toLowerCase()}`;
    const cur = best.get(k);
    if (!cur || (p.liquidityUsd ?? 0) > (cur.liquidityUsd ?? 0)) best.set(k, p);
  }
  return [...best.values()];
}

/**
 * Generic adapter for any chain in the registry, composed from providers:
 * GeckoTerminal (pools, candles, trades, token profile), DexScreener
 * (search, fallback pool lookup), GoPlus (risk). A chain needing a
 * different source (an own indexer, an RPC-native source) implements
 * ChainAdapter directly and registers it in createAdapters().
 */
export function createAdapter(chain: ChainConfig, o: AdapterOptions): ChainAdapter {
  const gt = geckoTerminal(o.fetchJson, o.geckoTerminal);
  const ds = dexScreener(o.fetchJson);
  const gp = goPlus(o.fetchJson);
  const check = (a: string) => { if (!isAddress(chain, a)) throw new InvalidAddressError(chain, a); return normalizeAddress(chain, a); };

  // Pools where this token is the base asset (a pool quoting it, e.g. PUMP/BONK, prices the other token).
  const asBase = (a: string, pools: PoolSummary[]) => {
    const own = pools.filter((p) => p.base.address.toLowerCase() === a.toLowerCase());
    return (own.length ? own : pools).sort(byLiquidity);
  };
  const tokenPools = async (address: string): Promise<PoolSummary[]> => {
    const a = check(address);
    try {
      const pools = await gt.tokenPools(chain, a);
      if (pools.length) return asBase(a, pools);
    } catch { /* fall back to DexScreener */ }
    return asBase(a, await ds.tokenPairs(chain.providers.dexscreener, a));
  };

  return {
    chain,
    trending: (opts) => gt.trending(chain, opts?.window ?? "24h"),
    newPools: () => gt.newPools(chain),
    topPools: () => gt.topPools(chain),
    async search(query) {
      const q = query.trim().slice(0, 100);
      if (q.length < 2) return [];
      return dedupeByToken((await ds.search(q)).filter((p) => p.chain === chain.id)).sort(byLiquidity);
    },
    async token(address): Promise<TokenSummary | null> {
      const a = check(address);
      const [profile, pools] = await Promise.all([gt.token(chain, a).catch(() => null), tokenPools(a).catch(() => [] as PoolSummary[])]);
      const top = pools[0] ?? null;
      if (!profile && !top) return null;
      const liq = pools.reduce((t, p) => t + (p.liquidityUsd ?? 0), 0);
      return {
        chain: chain.id,
        address: profile?.address || top?.base.address || a,
        symbol: profile?.symbol || top?.base.symbol || "",
        name: profile?.name || top?.base.name || "",
        image: profile?.image ?? top?.base.image ?? null,
        priceUsd: profile?.priceUsd ?? top?.priceUsd ?? null,
        marketCapUsd: profile?.marketCapUsd ?? top?.marketCapUsd ?? null,
        fdvUsd: profile?.fdvUsd ?? top?.fdvUsd ?? null,
        liquidityUsd: pools.length ? liq : profile?.liquidityUsd ?? null,
        volume24hUsd: profile?.volume24hUsd ?? (pools.length ? pools.reduce((t, p) => t + (p.volumeUsd.h24 ?? 0), 0) : null),
        priceChange24hPct: top?.priceChangePct.h24 ?? null,
        holders: profile?.holders ?? null,
        topPool: top?.address ?? null,
        poolCount: pools.length,
        links: profile?.links ?? { website: null, twitter: null, telegram: null },
        source: [profile ? profile.source : null, top ? top.source : null].filter((x, i, arr) => x && arr.indexOf(x) === i).join(" + ") || "unavailable",
      };
    },
    tokenPools,
    pool: async (address) => gt.pool(chain, check(address)),
    ohlcv: async (pool, tf, opts) => gt.ohlcv(chain, check(pool), tf, opts?.limit, opts?.before),
    trades: async (pool) => gt.trades(chain, check(pool)),
    risk: async (address) => gp.risk(chain, check(address)),
  };
}

/** Adapters for every registered chain (or a subset). */
export function createAdapters(o: AdapterOptions, chainIds?: string[]): Map<string, ChainAdapter> {
  const list = chainIds ? chainIds.map((id) => chainById(id)).filter((c): c is ChainConfig => !!c) : [...CHAINS];
  return new Map(list.map((c) => [c.id, createAdapter(c, o)]));
}

/** One upstream search across every supported chain (one row per token, deepest pool first). */
export async function searchAllChains(o: AdapterOptions, query: string): Promise<PoolSummary[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  return dedupeByToken(await dexScreener(o.fetchJson).search(q)).sort(byLiquidity);
}

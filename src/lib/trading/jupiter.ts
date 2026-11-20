import "server-only";
import { cached } from "../server/cache";
import { fetchUpstream } from "../server/http";

const BASE = "https://lite-api.jup.ag";

export interface JupToken {
  address: string; name: string; symbol: string; icon: string | null; decimals: number;
  verified: boolean; usdPrice: number | null; liquidity: number | null; organicScore: number | null;
  mintAuthorityDisabled: boolean | null; freezeAuthorityDisabled: boolean | null; topHoldersPct: number | null;
  holderCount: number | null; tags: string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const tok = (t: any): JupToken => ({
  address: t.id, name: t.name, symbol: t.symbol, icon: t.icon ?? null, decimals: t.decimals,
  verified: Boolean(t.isVerified), usdPrice: t.usdPrice ?? null, liquidity: t.liquidity ?? null,
  organicScore: t.organicScore ?? null,
  mintAuthorityDisabled: t.audit?.mintAuthorityDisabled ?? null,
  freezeAuthorityDisabled: t.audit?.freezeAuthorityDisabled ?? null,
  topHoldersPct: t.audit?.topHoldersPercentage ?? null,
  holderCount: t.holderCount ?? null,
  tags: t.tags ?? [],
});

export function searchTokens(query: string) {
  const q = query.trim().slice(0, 64);
  return cached(`jup:search:${q.toLowerCase()}`, "Jupiter", { ttlMs: 60_000 }, async () => {
    const raw = await fetchUpstream<any[]>(`${BASE}/tokens/v2/search?query=${encodeURIComponent(q)}`);
    return raw.slice(0, 20).map(tok);
  });
}

export function getPrices(mints: string[]) {
  const ids = [...new Set(mints)].slice(0, 50).sort().join(",");
  return cached(`jup:price:${ids}`, "Jupiter", { ttlMs: 10_000 }, async () => {
    const raw = await fetchUpstream<Record<string, { usdPrice: number; priceChange24h?: number; decimals: number }>>(`${BASE}/price/v3?ids=${ids}`);
    return raw;
  });
}

export interface QuoteParams { inputMint: string; outputMint: string; amount: string; slippageBps: number; swapMode?: "ExactIn" }

/** Quotes are never cached for long — they move every block. */
export function getQuote(p: QuoteParams) {
  const qs = new URLSearchParams({
    inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount,
    slippageBps: String(p.slippageBps), restrictIntermediateTokens: "true",
  });
  return cached(`jup:quote:${qs}`, "Jupiter", { ttlMs: 2000, staleMs: 0 }, () => fetchUpstream<any>(`${BASE}/swap/v1/quote?${qs}`, { retries: 0 }));
}

/** Builds an unsigned versioned transaction for the user's wallet to sign. */
export function buildSwapTransaction(quoteResponse: unknown, userPublicKey: string) {
  return fetchUpstream<{ swapTransaction: string; lastValidBlockHeight: number; prioritizationFeeLamports?: number; computeUnitLimit?: number; simulationError?: unknown }>(
    `${BASE}/swap/v1/swap`,
    {
      method: "POST",
      retries: 0,
      timeoutMs: 15_000,
      body: {
        quoteResponse,
        userPublicKey,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: false,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "medium" } },
      },
    },
  );
}

/** Metadata + price for many mints at once (comma-separated search). */
export function getTokensInfo(mints: string[]) {
  const ids = [...new Set(mints)].slice(0, 100).sort().join(",");
  return cached(`jup:info:${ids}`, "Jupiter", { ttlMs: 60_000 }, async () => {
    const raw = await fetchUpstream<any[]>(`${BASE}/tokens/v2/search?query=${ids}`);
    return raw.map(tok);
  });
}

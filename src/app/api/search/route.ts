import { getMarkets, pricesAgree, searchCoins } from "@/lib/market/markets";
import { getPairsByAddress, searchPairs } from "@/lib/market/dexscreener";
import { detectAddress, getChain } from "@/lib/chains";
import { NextResponse } from "next/server";
import type { DexPair, SearchResult } from "@/lib/types";

/** Unified search: listed coins (CoinLore top 500) + DEX pairs/contracts (DexScreener). */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ coins: [], pairs: [], addressQuery: null } satisfies SearchResult);
  const addressQuery = detectAddress(q);
  const [coins, pairs] = await Promise.allSettled([
    addressQuery ? Promise.resolve({ data: [] }) : searchCoins(q),
    addressQuery ? getPairsByAddress(q) : searchPairs(q),
  ]);
  // Impostor guard: an on-chain token using the ticker of a top listed coin whose
  // price is far from that coin's real price is a look-alike — don't surface it.
  const listed = new Map<string, number>();
  try { for (const c of (await getMarkets({ perPage: 250 })).data) if (c.price) listed.set(c.symbol.toUpperCase(), c.price); } catch { /* guard off if prices unavailable */ }
  const impostor = (p: DexPair) => {
    const real = listed.get(p.base.symbol.trim().toUpperCase().replace(/^W(?=SOL$|ETH$|BTC$|BNB$|AVAX$)/, ""));
    if (!real || !p.priceUsd) return false;
    // Real markets for a coin trade within a few percent of it (sub-$0.001 prices allow for rounding).
    return Math.abs(p.priceUsd - real) / real > 0.08 && !(real < 0.001 && pricesAgree(p.priceUsd, real));
  };
  // One row per token (deepest pair), supported chains only.
  const seen = new Set<string>();
  const dedup: DexPair[] = [];
  for (const p of pairs.status === "fulfilled" ? pairs.value.data : []) {
    if (!getChain(p.chain)) continue;
    if (!addressQuery && impostor(p)) continue;
    const k = `${p.chain}:${p.base.address}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(p);
  }
  dedup.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  const body: SearchResult & { errors?: string[] } = {
    coins: coins.status === "fulfilled" ? coins.value.data : [],
    pairs: dedup.slice(0, 10),
    addressQuery,
  };
  const errors = [coins, pairs].filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason));
  if (errors.length) body.errors = errors;
  return NextResponse.json(body, { headers: { "cache-control": "public, s-maxage=30" } });
}

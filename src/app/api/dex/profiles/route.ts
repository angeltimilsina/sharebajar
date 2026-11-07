import { getLatestProfiles, getTokensBatch, getTopBoosts } from "@/lib/market/dexscreener";
import { getChain } from "@/lib/chains";
import { fail, ok } from "@/lib/server/respond";
import type { DexPair } from "@/lib/types";

/** Latest token profiles / top boosted tokens, enriched with market data. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const kind = url.searchParams.get("kind") === "boosts" ? "boosts" : "latest";
    const env = kind === "boosts" ? await getTopBoosts() : await getLatestProfiles();
    const network = url.searchParams.get("network");
    const profiles = env.data.filter((p) => getChain(p.chain) && (!network || p.chain === network)).slice(0, 30);
    const byChain = new Map<string, string[]>();
    for (const p of profiles) byChain.set(p.chain, [...(byChain.get(p.chain) ?? []), p.address]);
    const pairs: DexPair[] = [];
    await Promise.all(
      [...byChain].map(async ([chain, addrs]) => {
        try {
          pairs.push(...(await getTokensBatch(getChain(chain)!.dexscreener, addrs)).data);
        } catch { /* partial data is fine */ }
      }),
    );
    const byAddr = new Map(pairs.map((p) => [p.base.address, p]));
    return ok({ ...env, data: profiles.map((p) => ({ ...p, pair: byAddr.get(p.address) ?? null })) }, 30);
  } catch (e) {
    return fail(e, "DexScreener");
  }
}

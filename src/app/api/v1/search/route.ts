import { addressKind, CHAINS, dedupeByToken, byLiquidity } from "@bajar/chain-adapters";
import { searchAll, adapterFor, chainParam, options, v1, ApiError } from "@/lib/api/v1";

/** Search tokens by name, symbol or contract address across chains (or one chain with ?chain=). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim().slice(0, 100);
  const chain = u.searchParams.get("chain");
  return v1(req, `search:${chain ?? "*"}:${q.toLowerCase()}`, { ttlMs: 30_000, maxAge: 30 }, async () => {
    if (q.length < 2) throw new ApiError(400, "Query must be at least 2 characters.", "invalid_query");
    const kind = addressKind(q);
    const targets = chain ? [chainParam(chain)] : CHAINS.filter((c) => !kind || c.kind === kind).map((c) => c.id);
    if (kind) {
      // A contract address: look it up directly on each matching chain.
      const found = await Promise.allSettled(targets.map((id) => adapterFor(id).tokenPools(q)));
      return dedupeByToken(found.flatMap((r) => (r.status === "fulfilled" ? r.value : []))).sort(byLiquidity).slice(0, 25);
    }
    return (await searchAll(q)).filter((p) => targets.includes(p.chain)).slice(0, 25);
  });
}
export const OPTIONS = options;

import { chainById, isAddress, normalizeAddress } from "@bajar/chain-adapters";
import { q } from "@/lib/treasury/db";
import { ApiError, options, v1 } from "@/lib/api/v1";

interface Row { time: string | Date; price_usd: number | null; liquidity_usd: number | null; volume_24h_usd: number | null; fdv_usd: number | null; source: string }

/**
 * Indexed history for a pool (price, liquidity, 24h volume, FDV per minute),
 * written by the BAJAR indexer (services/indexer). Without the indexer running
 * against this database the endpoint says so (503) instead of returning nothing.
 */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await ctx.params;
  const hours = Math.min(720, Math.max(1, Number(new URL(req.url).searchParams.get("hours") ?? 24) || 24));
  return v1(req, `history:${chain}:${address}:${hours}`, { ttlMs: 30_000, maxAge: 30 }, async () => {
    const c = chainById(chain);
    if (!c) throw new ApiError(404, "Unknown chain.", "unknown_chain");
    if (!isAddress(c, address)) throw new ApiError(400, `Not a valid ${c.name} address.`, "invalid_address");
    let rows: Row[];
    try {
      rows = await q<Row>(
        `select time, price_usd, liquidity_usd, volume_24h_usd, fdv_usd, source from pool_snapshots
         where chain=$1 and address=$2 and time > now() - make_interval(hours => $3) order by time asc limit 5000`,
        [c.id, c.kind === "evm" ? normalizeAddress(c, address) : address, hours]);
    } catch (e) {
      if (/pool_snapshots|does not exist/i.test(String(e))) throw new ApiError(503, "Indexed history is not available: the BAJAR indexer isn't connected to this deployment's database.", "indexer_unavailable");
      throw e;
    }
    return rows.map((r) => ({ time: new Date(r.time).toISOString(), priceUsd: r.price_usd, liquidityUsd: r.liquidity_usd, volume24hUsd: r.volume_24h_usd, fdvUsd: r.fdv_usd, source: `BAJAR indexer (${r.source})` }));
  });
}
export const OPTIONS = options;

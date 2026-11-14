import { adapterFor, options, v1, ApiError } from "@/lib/api/v1";

/** Token profile: price, market cap, FDV, liquidity, volume, holders, top pool, links. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await ctx.params;
  return v1(req, `token:${chain}:${address}`, { ttlMs: 30_000, staleMs: 30 * 60_000, maxAge: 30 }, async () => {
    const t = await adapterFor(chain).token(address);
    if (!t) throw new ApiError(404, "Token not found on this chain.", "not_found");
    return t;
  });
}
export const OPTIONS = options;

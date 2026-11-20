import { adapterFor, options, v1, ApiError } from "@/lib/api/v1";

/** One pool: price, liquidity, volume, price changes, transactions. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await ctx.params;
  return v1(req, `pool:${chain}:${address}`, { ttlMs: 20_000, staleMs: 30 * 60_000, maxAge: 20 }, async () => {
    const p = await adapterFor(chain).pool(address);
    if (!p) throw new ApiError(404, "Pool not found on this chain.", "not_found");
    return p;
  });
}
export const OPTIONS = options;

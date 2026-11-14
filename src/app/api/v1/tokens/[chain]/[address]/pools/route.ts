import { adapterFor, options, v1 } from "@/lib/api/v1";

/** All liquidity pools for a token, deepest first. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await ctx.params;
  return v1(req, `tpools:${chain}:${address}`, { ttlMs: 60_000, staleMs: 30 * 60_000, maxAge: 60 }, async () => adapterFor(chain).tokenPools(address));
}
export const OPTIONS = options;

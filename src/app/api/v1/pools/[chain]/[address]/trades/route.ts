import { adapterFor, options, v1 } from "@/lib/api/v1";

/** Latest swaps in a pool (buy/sell, USD size, wallet, tx hash). */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await ctx.params;
  return v1(req, `trades:${chain}:${address}`, { ttlMs: 8_000, staleMs: 5 * 60_000, maxAge: 8 }, async () => adapterFor(chain).trades(address));
}
export const OPTIONS = options;

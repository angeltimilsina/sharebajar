import { adapterFor, options, v1 } from "@/lib/api/v1";

/** Token risk intelligence: honeypot, taxes, permissions, holder concentration, locked liquidity. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await ctx.params;
  return v1(req, `risk:${chain}:${address}`, { ttlMs: 10 * 60_000, staleMs: 24 * 3600_000, maxAge: 600 }, async () => adapterFor(chain).risk(address));
}
export const OPTIONS = options;

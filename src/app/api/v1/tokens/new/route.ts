import { adapterFor, chainParam, options, v1 } from "@/lib/api/v1";

/** Newly created pools on a chain (?chain=base). */
export async function GET(req: Request) {
  const chain = new URL(req.url).searchParams.get("chain") ?? "solana";
  return v1(req, `new:${chain}`, { ttlMs: 45_000, staleMs: 30 * 60_000, maxAge: 45 }, async () => adapterFor(chainParam(chain)).newPools());
}
export const OPTIONS = options;

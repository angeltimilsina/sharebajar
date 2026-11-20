import { adapterFor, chainParam, options, v1 } from "@/lib/api/v1";

/** Top pools by 24h volume on a chain (?chain=solana). */
export async function GET(req: Request) {
  const chain = new URL(req.url).searchParams.get("chain") ?? "solana";
  return v1(req, `top:${chain}`, { ttlMs: 60_000, staleMs: 30 * 60_000, maxAge: 60 }, async () => adapterFor(chainParam(chain)).topPools());
}
export const OPTIONS = options;

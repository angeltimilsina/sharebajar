import { adapterFor, chainParam, oneOf, options, v1 } from "@/lib/api/v1";

/** Trending pools on a chain (?chain=solana&window=24h). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const chain = u.searchParams.get("chain") ?? "solana";
  const window = u.searchParams.get("window");
  return v1(req, `trending:${chain}:${window}`, { ttlMs: 60_000, staleMs: 30 * 60_000, maxAge: 60 }, async () =>
    adapterFor(chainParam(chain)).trending({ window: oneOf(window, ["5m", "1h", "6h", "24h"] as const, "24h") }));
}
export const OPTIONS = options;

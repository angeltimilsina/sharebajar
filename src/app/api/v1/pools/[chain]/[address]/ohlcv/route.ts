import { adapterFor, oneOf, options, v1 } from "@/lib/api/v1";

const TF = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const TTL: Record<(typeof TF)[number], number> = { "1m": 15_000, "5m": 30_000, "15m": 60_000, "1h": 120_000, "4h": 300_000, "1d": 600_000 };

/** Candles for a pool (?tf=1h&limit=300&before=<unix seconds>), ascending. */
export async function GET(req: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await ctx.params;
  const u = new URL(req.url);
  const tf = u.searchParams.get("tf");
  const limit = Math.min(1000, Math.max(1, Number(u.searchParams.get("limit") ?? 300) || 300));
  const before = Number(u.searchParams.get("before") ?? 0) || undefined;
  const t = TF.includes(tf as (typeof TF)[number]) ? (tf as (typeof TF)[number]) : "1h";
  return v1(req, `ohlcv:${chain}:${address}:${tf}:${limit}:${before}`, { ttlMs: TTL[t], staleMs: 30 * 60_000, maxAge: Math.round(TTL[t] / 1000) }, async () =>
    adapterFor(chain).ohlcv(address, oneOf(tf, TF, "1h"), { limit, before }));
}
export const OPTIONS = options;

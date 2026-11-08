import { NextResponse } from "next/server";
import { z } from "zod";
import { readIntent, recordIntent } from "@/lib/treasury/intents";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { crossSiteRejection } from "@/lib/server/guard";

const Body = z.object({ intentToken: z.string().min(20).max(4000), txHash: z.string().min(40).max(100) });

/**
 * Public: the browser reports the transaction hash of a swap it just sent,
 * together with the server-sealed intent. Nothing here is trusted as revenue —
 * the indexer verifies the transaction and the fee transfer on-chain.
 */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`intent:${clientIp(req)}`, 30, 30);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const claims = readIntent(parsed.data.intentToken);
  if (!claims) return NextResponse.json({ error: "Invalid or expired intent" }, { status: 400 });
  const tx = parsed.data.txHash;
  const okFormat = claims.chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(tx) : claims.chain === "bitcoin" ? /^[0-9a-f]{64}$/.test(tx) : /^0x[0-9a-fA-F]{64}$/.test(tx);
  if (!okFormat) return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
  try {
    const r = await recordIntent(claims, claims.chain === "solana" ? tx : tx.toLowerCase());
    return NextResponse.json({ ok: true, ...r, verification: "pending — confirmed by the on-chain indexer" });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { v2Execute } from "@/lib/trading/jupiterV2";
import { readIntent, recordIntent } from "@/lib/treasury/intents";
import { log } from "@/lib/server/log";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { crossSiteRejection } from "@/lib/server/guard";

const Body = z.object({ signedTransaction: z.string().min(100).max(10_000), requestId: z.string().min(8).max(100), intentToken: z.string().min(20).max(4000) });

/** Jupiter /order route: forward the user-signed transaction to Jupiter /execute. */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`exec:${clientIp(req)}`, 10, 20);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const claims = readIntent(parsed.data.intentToken);
  if (!claims || claims.requestId !== parsed.data.requestId) return NextResponse.json({ error: "Intent does not match this order" }, { status: 400 });
  try {
    const r = await v2Execute(parsed.data.signedTransaction, parsed.data.requestId);
    // The swap has landed (or failed) on-chain at this point: recording the fee intent is
    // bookkeeping and must never turn a submitted swap into an error for the user.
    if (r.signature) await recordIntent(claims, r.signature).catch((e) => log("warn", "intent not recorded", { error: String(e) }));
    return NextResponse.json(r, { status: r.status === "Success" ? 200 : 422 });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}

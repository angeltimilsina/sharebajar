import { NextResponse } from "next/server";
import { z } from "zod";
import { solanaPrepare } from "@/lib/treasury/swaps";
import { fail } from "@/lib/server/respond";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { crossSiteRejection } from "@/lib/server/guard";

const MINT = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Body = z.object({ inputMint: MINT, outputMint: MINT, amount: z.string().regex(/^\d{1,30}$/), slippageBps: z.number().int().min(1).max(5000), userPublicKey: MINT });

/**
 * Returns a fresh quote and an UNSIGNED transaction (already simulated) plus a
 * sealed fee intent. Signing happens only in the user's wallet.
 */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`build:${clientIp(req)}`, 10, 20);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid swap request" }, { status: 400 });
  try {
    const p = parsed.data;
    const r = await solanaPrepare({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount, slippageBps: p.slippageBps, taker: p.userPublicKey });
    return NextResponse.json({ ...r, builtAt: Date.now() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/simulation failed/i.test(m)) return NextResponse.json({ error: m }, { status: 422 });
    return fail(e, "Jupiter");
  }
}

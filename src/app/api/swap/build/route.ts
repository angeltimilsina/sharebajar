import { buildSwapTransaction } from "@/lib/trading/jupiter";
import { BadRequest, fail } from "@/lib/server/respond";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({
  userPublicKey: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  quoteResponse: z.object({ inputMint: z.string(), outputMint: z.string(), inAmount: z.string(), outAmount: z.string() }).passthrough(),
});

/**
 * Returns an UNSIGNED transaction. Signing happens only in the user's wallet
 * after they explicitly approve it — the server never sees keys.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`build:${clientIp(req)}`, 10, 20);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new BadRequest("Invalid swap request");
    const tx = await buildSwapTransaction(parsed.data.quoteResponse, parsed.data.userPublicKey);
    return NextResponse.json({ ...tx, builtAt: Date.now() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(e, "Jupiter");
  }
}

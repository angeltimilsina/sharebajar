import { NextResponse } from "next/server";
import { solanaQuote } from "@/lib/treasury/swaps";
import { BadRequest, fail } from "@/lib/server/respond";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Solana quote via Jupiter Swap V2 with the platform fee (if any) disclosed. */
export async function GET(req: Request) {
  const rl = rateLimit(`quote:${clientIp(req)}`, 30, 60);
  if (!rl.ok) return NextResponse.json({ error: "Too many quote requests" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  const url = new URL(req.url);
  try {
    const inputMint = url.searchParams.get("inputMint") ?? "";
    const outputMint = url.searchParams.get("outputMint") ?? "";
    const amount = url.searchParams.get("amount") ?? "";
    const taker = url.searchParams.get("taker") || undefined;
    const slippageBps = Number(url.searchParams.get("slippageBps") ?? 50);
    if (!MINT.test(inputMint) || !MINT.test(outputMint)) throw new BadRequest("Invalid mint");
    if (inputMint === outputMint) throw new BadRequest("Input and output tokens must differ");
    if (!/^\d{1,30}$/.test(amount) || amount === "0") throw new BadRequest("Invalid amount");
    if (taker && !MINT.test(taker)) throw new BadRequest("Invalid taker");
    if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) throw new BadRequest("Slippage must be 0.01%–50%");
    const data = await solanaQuote({ inputMint, outputMint, amount, slippageBps, taker });
    return NextResponse.json({ data, source: "Jupiter Swap V2", fetchedAt: Date.now(), stale: false }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(e, "Jupiter");
  }
}

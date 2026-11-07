import { getQuote } from "@/lib/trading/jupiter";
import { BadRequest, fail, ok, param } from "@/lib/server/respond";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { NextResponse } from "next/server";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(req: Request) {
  const rl = rateLimit(`quote:${clientIp(req)}`, 30, 60);
  if (!rl.ok) return NextResponse.json({ error: "Too many quote requests" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  const url = new URL(req.url);
  try {
    const inputMint = param(url, "inputMint");
    const outputMint = param(url, "outputMint");
    const amount = param(url, "amount");
    const slippageBps = Number(url.searchParams.get("slippageBps") ?? 50);
    if (!MINT.test(inputMint) || !MINT.test(outputMint)) throw new BadRequest("Invalid mint");
    if (inputMint === outputMint) throw new BadRequest("Input and output tokens must differ");
    if (!/^\d{1,30}$/.test(amount) || amount === "0") throw new BadRequest("Invalid amount");
    if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) throw new BadRequest("Slippage must be 0.01%–50%");
    return ok(await getQuote({ inputMint, outputMint, amount, slippageBps }), 0);
  } catch (e) {
    return fail(e, "Jupiter");
  }
}

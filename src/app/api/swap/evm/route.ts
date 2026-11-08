import { NextResponse } from "next/server";
import { evmQuote } from "@/lib/treasury/swaps";
import { zeroXConfigured } from "@/lib/trading/zerox";
import { ZEROX_CHAINS } from "@/lib/treasury/tokens";
import { fail, BadRequest } from "@/lib/server/respond";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** EVM quote via 0x Swap API (firm quote + transaction when `taker` is given). */
export async function GET(req: Request) {
  if (!zeroXConfigured()) return NextResponse.json({ error: "EVM swaps are not configured on this deployment." }, { status: 503 });
  const rl = rateLimit(`evmq:${clientIp(req)}`, 30, 60);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const u = new URL(req.url);
  try {
    const chain = u.searchParams.get("chain") ?? "";
    const sellToken = u.searchParams.get("sellToken") ?? "";
    const buyToken = u.searchParams.get("buyToken") ?? "";
    const sellAmount = u.searchParams.get("sellAmount") ?? "";
    const taker = u.searchParams.get("taker") || undefined;
    const slippageBps = Number(u.searchParams.get("slippageBps") ?? 100);
    if (!ZEROX_CHAINS[chain]) throw new BadRequest("Unsupported network");
    if (!ADDR.test(sellToken) || !ADDR.test(buyToken) || sellToken.toLowerCase() === buyToken.toLowerCase()) throw new BadRequest("Invalid tokens");
    if (!/^\d{1,40}$/.test(sellAmount) || sellAmount === "0") throw new BadRequest("Invalid amount");
    if (taker && !ADDR.test(taker)) throw new BadRequest("Invalid taker");
    if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) throw new BadRequest("Invalid slippage");
    const data = await evmQuote({ chain, sellToken, buyToken, sellAmount, taker, slippageBps });
    return NextResponse.json({ data, source: "0x Swap API", fetchedAt: Date.now() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(e, "0x");
  }
}

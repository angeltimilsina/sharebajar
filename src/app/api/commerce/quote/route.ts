import { z } from "zod";
import { NextResponse } from "next/server";
import { createQuote, PayError } from "@/lib/commerce/orders";
import { crossSiteRejection, requestHost } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { currentSession, planOf, profileForSession } from "@/lib/pro/profile";

const Body = z.object({
  offerId: z.string().max(200),
  quantity: z.number().int().min(1).max(5),
  shippingId: z.string().max(10).optional(),
  asset: z.enum(["USDC", "USDT", "ETH", "SOL", "BTC"]),
  network: z.string().max(20).optional(),
  wallet: z.string().min(32).max(64),
  chainType: z.enum(["solana", "evm"]),
});

/** Itemized, expiring BAJAR Pay quote (10 minutes). */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`cq:${clientIp(req)}`, 30, 30);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Invalid quote request" }, { status: 400 });
  const d = p.data;
  if (d.chainType === "evm" ? !/^0x[0-9a-fA-F]{40}$/.test(d.wallet) : !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(d.wallet)) return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  // BAJAR Plus (Pro) members pay no BAJAR Pay fee — only when the signed-in wallet is the paying wallet.
  let plus = false;
  const s = await currentSession().catch(() => null);
  if (s && s.address.toLowerCase() === d.wallet.toLowerCase()) {
    try { plus = (await planOf(await profileForSession(s))).tier === "pro"; } catch { /* plan unknown: fee applies */ }
  }
  try {
    const quote = await createQuote({ ...d, wallet: d.chainType === "evm" ? d.wallet.toLowerCase() : d.wallet, plus, host: requestHost(req) });
    return NextResponse.json({ quote });
  } catch (e) {
    if (e instanceof PayError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: "Quotes are unavailable right now." }, { status: 503 });
  }
}

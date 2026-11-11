import { z } from "zod";
import { NextResponse } from "next/server";
import { ordersFor } from "@/lib/commerce/orders";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { currentSession, profileForSession } from "@/lib/pro/profile";

const Body = z.object({ tokens: z.array(z.string().max(600)).max(50) });

/** Orders for the receipts this browser holds, plus the signed-in wallet's orders. */
export async function POST(req: Request) {
  const rl = rateLimit(`cor:${clientIp(req)}`, 30, 30);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const s = await currentSession().catch(() => null);
  try {
    const profileId = s ? await profileForSession(s).catch(() => null) : null;
    return NextResponse.json({ orders: await ordersFor({ wallet: s ? (s.chainType === "evm" ? s.address.toLowerCase() : s.address) : null, tokens: p.data.tokens, profileId }) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Orders are unavailable right now." }, { status: 503 });
  }
}

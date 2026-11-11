import { z } from "zod";
import { NextResponse } from "next/server";
import { cancelOrder, PayError } from "@/lib/commerce/orders";
import { crossSiteRejection } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

const Body = z.object({ token: z.string().max(600), reason: z.string().max(200).optional() });

/** Cancel an order that hasn't shipped and refund it. */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`cca:${clientIp(req)}`, 10, 10);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json({ order: await cancelOrder(p.data.token, p.data.reason ?? "") });
  } catch (e) {
    if (e instanceof PayError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: "Cancellation is unavailable right now." }, { status: 503 });
  }
}

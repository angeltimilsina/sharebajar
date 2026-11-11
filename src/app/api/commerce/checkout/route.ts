import { z } from "zod";
import { NextResponse } from "next/server";
import { authorizeOrder, PayError } from "@/lib/commerce/orders";
import { sha256 } from "@/lib/treasury/crypto";
import { crossSiteRejection } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

const Body = z.object({
  quoteId: z.string().max(40),
  signature: z.string().min(40).max(200),
  idempotencyKey: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
  consent: z.literal(true),
  shipping: z.object({ name: z.string().max(80), line1: z.string().max(120), line2: z.string().max(120).optional(), city: z.string().max(60), region: z.string().max(60).optional(), postal: z.string().max(20), country: z.string().max(2), email: z.string().max(120).optional() }),
});

/** Places the order after the customer's wallet signed the exact quote. Idempotent. */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`cco:${clientIp(req)}`, 10, 10);
  if (!rl.ok) return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues.some((i) => i.path[0] === "consent") ? "Confirm the order details before paying." : "Invalid order request" }, { status: 400 });
  try {
    const order = await authorizeOrder({ ...p.data, ipHash: sha256(`commerce:${clientIp(req)}`) });
    return NextResponse.json({ order });
  } catch (e) {
    if (e instanceof PayError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: "Checkout is unavailable right now. Nothing was charged." }, { status: 503 });
  }
}

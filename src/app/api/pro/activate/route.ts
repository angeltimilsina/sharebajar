import { NextResponse } from "next/server";
import { crossSiteRejection } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { currentSession, profileForSession } from "@/lib/pro/profile";
import { activateFromPayment } from "@/lib/pro/payment";

/** Activate Pro from a confirmed USDC payment (verified on-chain). */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`pro:${clientIp(req)}`, 10, 10);
  if (!rl.ok) return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { signature?: string } | null;
  if (!b?.signature || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(b.signature)) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  try {
    const r = await activateFromPayment(await profileForSession(s), b.signature);
    return NextResponse.json(r.ok ? r : { error: r.error }, { status: r.ok ? 200 : r.status });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 503 });
  }
}

import { NextResponse } from "next/server";
import { crossSiteRejection } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { createConnectToken, currentSession, peekConnectToken, profileForSession } from "@/lib/pro/profile";

const TOKEN = /^[1-9A-HJ-NP-Za-km-z]{20,40}$/;

/** Bajar Wallet (hybrid-signed-in) creates a one-time connection token. */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`ctok:${clientIp(req)}`, 10, 10);
  if (!rl.ok) return NextResponse.json({ error: "Too many tokens. Wait a minute." }, { status: 429 });
  const s = await currentSession();
  if (!s?.pq) return NextResponse.json({ error: "Sign in with Bajar Wallet first." }, { status: 401 });
  try {
    const t = await createConnectToken(await profileForSession(s), s.address);
    return NextResponse.json(t, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Connections are unavailable right now." }, { status: 503 });
  }
}

/** Shows which Bajar Wallet a token connects to (for the /connect page). */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!TOKEN.test(token)) return NextResponse.json({ valid: false }, { status: 400 });
  const rl = rateLimit(`ctokp:${clientIp(req)}`, 30, 30);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    const t = await peekConnectToken(token);
    return NextResponse.json(t ? { valid: true, ...t } : { valid: false }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ valid: false, error: "Connections are unavailable right now." }, { status: 503 });
  }
}

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { unseal, verifyEvm, verifySolana } from "@/lib/server/auth";
import { consumeNonce, crossSiteRejection, requestHost } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { consumeConnectToken, linkWallet } from "@/lib/pro/profile";

interface Pending { message: string; nonce: string; host: string; address: string; chainType: "solana" | "evm"; token: string; exp: number }

/** Verifies the joining wallet's signature, uses up the token and connects the wallet. */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`cver:${clientIp(req)}`, 15, 15);
  if (!rl.ok) return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  const pending = unseal<Pending>((await cookies()).get("sb_conn")?.value, "link");
  if (!pending || pending.host !== requestHost(req)) return NextResponse.json({ error: "Connection request expired. Try again." }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { signature?: string; label?: string } | null;
  const sig = b?.signature;
  if (!sig || typeof sig !== "string" || sig.length > 200) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const ok = pending.chainType === "solana" ? verifySolana(pending.message, sig, pending.address) : verifyEvm(pending.message, sig, pending.address);
  if (!ok) return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  if (!consumeNonce(pending.nonce, pending.exp)) return NextResponse.json({ error: "This request was already used." }, { status: 409 });
  try {
    const profileId = await consumeConnectToken(pending.token);
    if (!profileId) return NextResponse.json({ error: "This connection token has expired or was already used." }, { status: 410 });
    const label = typeof b?.label === "string" ? b.label.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 40) || null : null;
    const r = await linkWallet(profileId, pending.chainType, pending.address, label);
    const res = NextResponse.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : 400 });
    res.cookies.delete({ name: "sb_conn", path: "/api/connect" });
    return res;
  } catch {
    return NextResponse.json({ error: "Connections are unavailable right now." }, { status: 503 });
  }
}

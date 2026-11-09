import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { unseal, verifyEvm, verifySolana } from "@/lib/server/auth";
import { consumeNonce, crossSiteRejection, requestHost } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { currentSession, linkWallet, profileForSession } from "@/lib/pro/profile";

interface Pending { message: string; nonce: string; host: string; address: string; chainType: "solana" | "evm"; profileAddr: string; exp: number }

/** Verifies the link signature and adds the wallet to the signed-in profile. */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`linkv:${clientIp(req)}`, 15, 15);
  if (!rl.ok) return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const pending = unseal<Pending>((await cookies()).get("sb_link")?.value, "link");
  if (!pending) return NextResponse.json({ error: "Link request expired. Try again." }, { status: 400 });
  if (pending.host !== requestHost(req) || pending.profileAddr !== s.address) return NextResponse.json({ error: "Link request doesn't match this session." }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { signature?: string; label?: string } | null;
  const sig = b?.signature;
  if (!sig || typeof sig !== "string" || sig.length > 200) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const ok = pending.chainType === "solana" ? verifySolana(pending.message, sig, pending.address) : verifyEvm(pending.message, sig, pending.address);
  if (!ok) return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  if (!consumeNonce(pending.nonce, pending.exp)) return NextResponse.json({ error: "This link request was already used." }, { status: 409 });
  const label = typeof b?.label === "string" ? b.label.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 40) || null : null;
  try {
    const r = await linkWallet(await profileForSession(s), pending.chainType, pending.address, label);
    const res = NextResponse.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : 400 });
    res.cookies.delete({ name: "sb_link", path: "/api/profile/link" });
    return res;
  } catch {
    return NextResponse.json({ error: "Profiles are unavailable right now." }, { status: 503 });
  }
}

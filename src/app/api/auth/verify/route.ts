import { NONCE_COOKIE, SESSION_COOKIE, seal, unseal, verifyEvm, verifySolana, type Session } from "@/lib/server/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fromB64, pqFingerprint, pqVerify } from "@/lib/bajar/keys";
import { consumeNonce, crossSiteRejection, requestHost, secureCookies } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

interface Pending { message: string; nonce: string; host: string; address: string; chainType: "solana" | "evm"; pqFingerprint?: string; exp: number }

const SESSION_TTL = 7 * 24 * 3600_000;

/**
 * Verifies a signed challenge and issues an httpOnly session.
 * Checks: same-origin request, rate limit, challenge authenticity + expiry,
 * domain binding, single use, classical signature, and (hybrid) the ML-DSA-65
 * signature from the key whose fingerprint is inside the signed message.
 */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`verify:${clientIp(req)}`, 20, 20);
  if (!rl.ok) return NextResponse.json({ error: "Too many sign-in attempts. Wait a minute." }, { status: 429 });
  const jar = await cookies();
  const pending = unseal<Pending>(jar.get(NONCE_COOKIE)?.value, "nonce");
  if (!pending?.nonce) return NextResponse.json({ error: "Sign-in request expired. Try again." }, { status: 400 });
  if (pending.host !== requestHost(req)) return NextResponse.json({ error: "Sign-in challenge was issued for a different site." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { signature?: string; pqSignature?: string; pqPublicKey?: string } | null;
  const sig = body?.signature;
  if (!sig || typeof sig !== "string" || sig.length > 200) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const valid = pending.chainType === "solana" ? verifySolana(pending.message, sig, pending.address) : verifyEvm(pending.message, sig, pending.address);
  if (!valid) return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  // Hybrid: if a PQ key was bound into the message, BOTH signatures must verify.
  let pq: Session["pq"];
  if (pending.pqFingerprint) {
    const ps = body?.pqSignature, pk = body?.pqPublicKey;
    let keyOk = false;
    try { keyOk = typeof pk === "string" && pk.length < 4000 && pqFingerprint(fromB64(pk)) === pending.pqFingerprint; } catch { keyOk = false; }
    if (!keyOk || typeof ps !== "string" || ps.length > 6000 || !pqVerify(pk!, pending.message, ps, "auth")) {
      return NextResponse.json({ error: "Post-quantum (ML-DSA-65) signature verification failed" }, { status: 401 });
    }
    pq = { alg: "ML-DSA-65", fingerprint: pending.pqFingerprint };
  }
  // Only after every check passes: burn the nonce so the same signature can't be replayed.
  if (!consumeNonce(pending.nonce, pending.exp)) return NextResponse.json({ error: "This sign-in request was already used." }, { status: 409 });
  const now = Date.now();
  const session: Session = { address: pending.address, chainType: pending.chainType, exp: now + SESSION_TTL, iat: now, ...(pq ? { pq } : {}) };
  const res = NextResponse.json({ ok: true, session }, { headers: { "cache-control": "no-store" } });
  const secure = secureCookies(req);
  res.cookies.set(SESSION_COOKIE, seal(session, "session"), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_TTL / 1000 });
  res.cookies.delete({ name: NONCE_COOKIE, path: "/api/auth" });
  return res;
}

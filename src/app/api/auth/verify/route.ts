import { NONCE_COOKIE, unseal, verifyEvm, verifySolana, type Session } from "@/lib/server/auth";
import { issueSession } from "@/lib/server/gateway";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fromB64, pqFingerprint, pqVerify } from "@/lib/bajar/keys";
import { consumeNonce, crossSiteRejection, requestHost, secureCookies } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

interface Pending { message: string; nonce: string; host: string; address: string; chainType: "solana" | "evm"; pqFingerprint?: string; exp: number }


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
  // One gateway: the session is recorded server-side (revocable) and set as an httpOnly cookie.
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  let session: Session;
  try { session = await issueSession(res, secureCookies(req), { address: pending.address, chainType: pending.chainType, pq }); }
  catch { return NextResponse.json({ error: "Sign-in is unavailable right now. Try again." }, { status: 503 }); }
  const { sid: _sid, ...pub } = session;
  void _sid;
  const out = NextResponse.json({ ok: true, session: pub }, { headers: res.headers });
  out.cookies.delete({ name: NONCE_COOKIE, path: "/api/auth" });
  return out;
}

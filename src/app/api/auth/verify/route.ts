import { NONCE_COOKIE, SESSION_COOKIE, seal, unseal, verifyEvm, verifySolana, type Session } from "@/lib/server/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fromB64, pqFingerprint, pqVerify } from "@/lib/bajar/keys";

interface Pending { message: string; address: string; chainType: "solana" | "evm"; pqFingerprint?: string }

export async function POST(req: Request) {
  const jar = await cookies();
  const pending = unseal<Pending>(jar.get(NONCE_COOKIE)?.value);
  if (!pending) return NextResponse.json({ error: "Sign-in request expired. Try again." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { signature?: string; pqSignature?: string; pqPublicKey?: string } | null;
  const sig = body?.signature;
  if (!sig || sig.length > 200) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const valid = pending.chainType === "solana" ? verifySolana(pending.message, sig, pending.address) : verifyEvm(pending.message, sig, pending.address);
  if (!valid) return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  // Hybrid: if a PQ key was bound into the message, BOTH signatures must verify.
  let pq: Session["pq"];
  // (Only the fingerprint is kept in the cookie — the 1952-byte key would exceed cookie limits.)
  if (pending.pqFingerprint) {
    const ps = body?.pqSignature, pk = body?.pqPublicKey;
    let keyOk = false;
    try { keyOk = !!pk && pk.length < 4000 && pqFingerprint(fromB64(pk)) === pending.pqFingerprint; } catch { keyOk = false; }
    if (!keyOk || !ps || ps.length > 6000 || !pqVerify(pk!, pending.message, ps, "auth")) {
      return NextResponse.json({ error: "Post-quantum (ML-DSA-65) signature verification failed" }, { status: 401 });
    }
    pq = { alg: "ML-DSA-65", fingerprint: pending.pqFingerprint! };
  }
  const session: Session = { address: pending.address, chainType: pending.chainType, exp: Date.now() + 7 * 24 * 3600_000, iat: Date.now(), ...(pq ? { pq } : {}) };
  const res = NextResponse.json({ ok: true, session });
  const secure = new URL(req.url).protocol === "https:";
  res.cookies.set(SESSION_COOKIE, seal(session), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 7 * 24 * 3600 });
  res.cookies.delete({ name: NONCE_COOKIE, path: "/api/auth" });
  return res;
}

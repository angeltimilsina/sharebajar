import { NONCE_COOKIE, SESSION_COOKIE, seal, unseal, verifyEvm, verifySolana, type Session } from "@/lib/server/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

interface Pending { message: string; address: string; chainType: "solana" | "evm" }

export async function POST(req: Request) {
  const jar = await cookies();
  const pending = unseal<Pending>(jar.get(NONCE_COOKIE)?.value);
  if (!pending) return NextResponse.json({ error: "Sign-in request expired. Try again." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { signature?: string } | null;
  const sig = body?.signature;
  if (!sig || sig.length > 200) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const valid = pending.chainType === "solana" ? verifySolana(pending.message, sig, pending.address) : verifyEvm(pending.message, sig, pending.address);
  if (!valid) return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  const session: Session = { address: pending.address, chainType: pending.chainType, exp: Date.now() + 7 * 24 * 3600_000, iat: Date.now() };
  const res = NextResponse.json({ ok: true, session });
  const secure = new URL(req.url).protocol === "https:";
  res.cookies.set(SESSION_COOKIE, seal(session), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 7 * 24 * 3600 });
  res.cookies.delete({ name: NONCE_COOKIE, path: "/api/auth" });
  return res;
}

import { NONCE_COOKIE, newNonce, seal, signInMessage } from "@/lib/server/auth";
import { NextResponse } from "next/server";
import { fromB64, pqFingerprint } from "@/lib/bajar/keys";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainType = url.searchParams.get("chainType") === "evm" ? "evm" : "solana";
  const address = url.searchParams.get("address") ?? "";
  if (!address || address.length > 64) return NextResponse.json({ error: "Missing address" }, { status: 400 });
  // Optional ML-DSA-65 public key (BAJAR hybrid sign-in). 1952 bytes raw.
  const pqPublicKey = url.searchParams.get("pqPublicKey") ?? undefined;
  let fp: string | undefined;
  if (pqPublicKey) {
    const raw = pqPublicKey.length < 4000 ? fromB64(pqPublicKey) : null;
    if (!raw || raw.length !== 1952) return NextResponse.json({ error: "Invalid ML-DSA-65 public key" }, { status: 400 });
    fp = pqFingerprint(raw);
  }
  const nonce = newNonce();
  const issuedAt = new Date().toISOString();
  const message = signInMessage(chainType, address, nonce, issuedAt, url.host, fp);
  const res = NextResponse.json({ message });
  res.cookies.set(NONCE_COOKIE, seal({ message, address, chainType, pqFingerprint: fp, exp: Date.now() + 5 * 60_000 }), {
    httpOnly: true, sameSite: "strict", secure: url.protocol === "https:", path: "/api/auth", maxAge: 300,
  });
  return res;
}

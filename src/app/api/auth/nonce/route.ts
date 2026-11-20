import { NONCE_COOKIE, newNonce, seal, signInMessage } from "@/lib/server/auth";
import { NextResponse } from "next/server";
import { fromB64, pqFingerprint } from "@/lib/bajar/keys";
import { requestHost, secureCookies } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;

/** Issues a one-time sign-in challenge bound to this domain, address and (optionally) an ML-DSA-65 key. */
export async function GET(req: Request) {
  const rl = rateLimit(`nonce:${clientIp(req)}`, 20, 20);
  if (!rl.ok) return NextResponse.json({ error: "Too many sign-in attempts. Wait a minute." }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  const url = new URL(req.url);
  const chainType = url.searchParams.get("chainType") === "evm" ? "evm" : "solana";
  const address = (url.searchParams.get("address") ?? "").trim();
  if (!(chainType === "evm" ? EVM : SOL).test(address)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  // Optional ML-DSA-65 public key (Bajar hybrid sign-in). 1952 bytes raw.
  const pqPublicKey = url.searchParams.get("pqPublicKey") ?? undefined;
  let fp: string | undefined;
  if (pqPublicKey) {
    let raw: Uint8Array | null = null;
    try { raw = pqPublicKey.length < 4000 ? fromB64(pqPublicKey) : null; } catch { raw = null; }
    if (!raw || raw.length !== 1952) return NextResponse.json({ error: "Invalid ML-DSA-65 public key" }, { status: 400 });
    fp = pqFingerprint(raw);
  }
  const host = requestHost(req);
  const nonce = newNonce();
  const issuedAt = new Date().toISOString();
  const exp = Date.now() + 5 * 60_000;
  const message = signInMessage(chainType, address, nonce, issuedAt, host, fp);
  const res = NextResponse.json({ message, expiresAt: exp }, { headers: { "cache-control": "no-store" } });
  res.cookies.set(NONCE_COOKIE, seal({ message, nonce, host, address, chainType, pqFingerprint: fp, exp }, "nonce"), {
    httpOnly: true, sameSite: "strict", secure: secureCookies(req), path: "/api/auth", maxAge: 300,
  });
  return res;
}

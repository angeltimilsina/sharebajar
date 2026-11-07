import { NONCE_COOKIE, newNonce, seal, signInMessage } from "@/lib/server/auth";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainType = url.searchParams.get("chainType") === "evm" ? "evm" : "solana";
  const address = url.searchParams.get("address") ?? "";
  if (!address || address.length > 64) return NextResponse.json({ error: "Missing address" }, { status: 400 });
  const nonce = newNonce();
  const issuedAt = new Date().toISOString();
  const message = signInMessage(chainType, address, nonce, issuedAt, url.host);
  const res = NextResponse.json({ message });
  res.cookies.set(NONCE_COOKIE, seal({ message, address, chainType, exp: Date.now() + 5 * 60_000 }), {
    httpOnly: true, sameSite: "strict", secure: url.protocol === "https:", path: "/api/auth", maxAge: 300,
  });
  return res;
}

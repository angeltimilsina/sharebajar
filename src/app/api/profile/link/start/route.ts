import { NextResponse } from "next/server";
import { newNonce, seal } from "@/lib/server/auth";
import { crossSiteRejection, requestHost, secureCookies } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { currentSession } from "@/lib/pro/profile";

const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;

/** One-time message the wallet being linked must sign (bound to the signed-in profile wallet and this site). */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`link:${clientIp(req)}`, 15, 15);
  if (!rl.ok) return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { address?: string; chainType?: string } | null;
  const chainType = b?.chainType === "evm" ? "evm" : "solana";
  const address = (b?.address ?? "").trim();
  if (!(chainType === "evm" ? EVM : SOL).test(address)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  const host = requestHost(req);
  const nonce = newNonce();
  const exp = Date.now() + 5 * 60_000;
  const message = [
    `${host} wants to link this wallet to your Bajar profile.`,
    "",
    `Wallet: ${address}`,
    `Profile (signed in as): ${s.address}`,
    "",
    "Linking only proves you control this wallet. It doesn't allow any transaction or transfer.",
    "",
    `URI: https://${host}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  const res = NextResponse.json({ message }, { headers: { "cache-control": "no-store" } });
  res.cookies.set("sb_link", seal({ message, nonce, host, address, chainType, profileAddr: s.address, exp }, "link"), { httpOnly: true, sameSite: "strict", secure: secureCookies(req), path: "/api/profile/link", maxAge: 300 });
  return res;
}

import { NextResponse } from "next/server";
import { newNonce, seal } from "@/lib/server/auth";
import { crossSiteRejection, requestHost, secureCookies } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { peekConnectToken } from "@/lib/pro/profile";

const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;
const TOKEN = /^[1-9A-HJ-NP-Za-km-z]{20,40}$/;

/** The message the joining wallet signs: names the Bajar Wallet it joins, this site and a nonce. */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`cstart:${clientIp(req)}`, 15, 15);
  if (!rl.ok) return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  const b = (await req.json().catch(() => null)) as { token?: string; address?: string; chainType?: string } | null;
  const chainType = b?.chainType === "evm" ? "evm" : "solana";
  const address = (b?.address ?? "").trim();
  if (!TOKEN.test(b?.token ?? "") || !(chainType === "evm" ? EVM : SOL).test(address)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const t = await peekConnectToken(b!.token!).catch(() => null);
  if (!t) return NextResponse.json({ error: "This connection token has expired or was already used. Create a new one in Bajar Wallet." }, { status: 410 });
  const host = requestHost(req);
  const nonce = newNonce();
  const exp = Math.min(Date.now() + 5 * 60_000, new Date(t.expiresAt).getTime());
  const message = [
    `${host} wants to connect this wallet to a Bajar Wallet.`,
    "",
    `This wallet: ${address}`,
    `Bajar Wallet: ${t.bajarAddress}`,
    "",
    "Connecting only proves you control this wallet so its balances show in Bajar Wallet. It doesn't allow any transaction or transfer.",
    "",
    `URI: https://${host}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  const res = NextResponse.json({ message, bajarAddress: t.bajarAddress }, { headers: { "cache-control": "no-store" } });
  res.cookies.set("sb_conn", seal({ message, nonce, host, address, chainType, token: b!.token, exp }, "link"), { httpOnly: true, sameSite: "strict", secure: secureCookies(req), path: "/api/connect", maxAge: 300 });
  return res;
}

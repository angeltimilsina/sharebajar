import { NextResponse } from "next/server";
import { newNonce, seal } from "@/lib/server/auth";
import { crossSiteRejection, requestHost, secureCookies } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { ProfileFields, launchOf } from "@/lib/launch/profile";

/** The message the token's creator signs to update its public profile (logo, description, links). */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`tprof:${clientIp(req)}`, 10, 10);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const b = (await req.json().catch(() => null)) as { chain?: string; token?: string; fields?: unknown } | null;
  const f = ProfileFields.safeParse(b?.fields);
  if (!f.success) return NextResponse.json({ error: f.error.issues[0]?.message ?? "Invalid profile" }, { status: 400 });
  if (!b?.chain || !b.token) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  const launch = await launchOf(b.chain, b.token).catch(() => null);
  if (!launch) return NextResponse.json({ error: "Only tokens launched with Bajar can have a Bajar profile." }, { status: 404 });
  const host = requestHost(req);
  const nonce = newNonce();
  const lines = Object.entries(f.data).filter(([, v]) => v).map(([k, v]) => `${k}: ${String(v).replace(/\s+/g, " ").slice(0, 200)}`);
  const message = [
    `${host} wants to update the public profile of ${launch.symbol} on ${launch.chain}.`,
    "",
    `Token: ${launch.mint}`,
    `Creator: ${launch.creator}`,
    "",
    ...(lines.length ? lines : ["(clear all fields)"]),
    "",
    "This only changes how the token is shown on Bajar. It doesn't allow any transaction.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  const res = NextResponse.json({ message, creator: launch.creator }, { headers: { "cache-control": "no-store" } });
  res.cookies.set("sb_tprof", seal({ message, nonce, host, chain: launch.chain, token: launch.mint, creator: launch.creator, fields: f.data, exp: Date.now() + 5 * 60_000 }, "link"), { httpOnly: true, sameSite: "strict", secure: secureCookies(req), path: "/api/launch/profile", maxAge: 300 });
  return res;
}

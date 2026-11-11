import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { connectorById } from "@/lib/commerce/profile";
import { currentSession, profileForSession } from "@/lib/pro/profile";
import { seal } from "@/lib/server/auth";
import { requestHost, secureCookies } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

/** Starts the store's official OAuth sign-in. Bajar never sees the store password. */
export async function GET(req: Request, ctx: { params: Promise<{ store: string }> }) {
  const { store } = await ctx.params;
  const back = (q: string) => NextResponse.redirect(new URL(`/agents/profile?${q}`, req.url));
  const rl = rateLimit(`sc:${clientIp(req)}`, 10, 10);
  if (!rl.ok) return back("error=rate");
  const c = connectorById(store);
  if (!c) return back("error=unknown");
  if (!c.configured) return back(`error=not_configured&store=${c.id}`);
  const s = await currentSession().catch(() => null);
  if (!s) return back("error=signin");
  const profileId = await profileForSession(s);
  const nonce = randomBytes(18).toString("base64url");
  const redirectUri = new URL(`/api/stores/callback/${c.id}`, req.url).toString();
  const res = NextResponse.redirect(c.authorizeUrl(nonce, redirectUri));
  res.cookies.set("sb_oauth", seal({ store: c.id, profileId, nonce, host: requestHost(req), redirectUri, exp: Date.now() + 10 * 60_000 }, "oauth"), {
    httpOnly: true, secure: secureCookies(req), sameSite: "lax", path: "/api/stores/callback", maxAge: 600,
  });
  return res;
}

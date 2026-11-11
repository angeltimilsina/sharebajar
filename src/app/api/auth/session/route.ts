import { SESSION_COOKIE, seal, unseal, type Session } from "@/lib/server/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { secureCookies } from "@/lib/server/guard";

const TTL = 7 * 24 * 3600_000;
/** A sign-in renews itself while used, up to 30 days after the wallet signature. */
const MAX_LIFETIME = 30 * 24 * 3600_000;
const RENEW_AFTER = 24 * 3600_000;

export async function GET(req: Request) {
  let session = unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value, "session");
  let renewed = false;
  if (session) {
    const now = Date.now();
    const iat = session.iat ?? session.exp - TTL;
    const limit = iat + MAX_LIFETIME;
    // Sliding renewal keeps you signed in across visits. `iat` is kept, so actions that need a recent signature still ask for one.
    if (session.exp - now < TTL - RENEW_AFTER && session.exp < limit) { session = { ...session, iat, exp: Math.min(now + TTL, limit) }; renewed = true; }
  }
  const res = NextResponse.json({ session }, { headers: { "cache-control": "no-store" } });
  if (session && renewed) res.cookies.set(SESSION_COOKIE, seal(session, "session"), { httpOnly: true, sameSite: "lax", secure: secureCookies(req), path: "/", maxAge: Math.floor((session.exp - Date.now()) / 1000) });
  return res;
}

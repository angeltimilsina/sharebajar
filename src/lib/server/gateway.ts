import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { q } from "@/lib/treasury/db";
import { SESSION_COOKIE, seal, unseal, type Session } from "./auth";

/**
 * Bajar's single authentication gateway.
 *
 * Every account in the app (wallet connection, Bajar Wallet, profile, Pro,
 * shopping, store logins, orders, admin) is accessed through one session,
 * and a session exists only after the server verified a wallet signature over
 * a single-use, domain-bound challenge (/api/auth/verify). Sessions are
 * recorded server-side, so signing out revokes them for real — a copied
 * cookie stops working — and "sign out everywhere" ends every session of an
 * address. Nothing else may read the session cookie directly.
 */

export const SESSION_TTL = 7 * 24 * 3600_000;
/** A sign-in renews while used, up to 30 days after the wallet signature. */
export const SESSION_MAX_LIFETIME = 30 * 24 * 3600_000;
const RENEW_AFTER = 24 * 3600_000;

const norm = (s: Pick<Session, "address" | "chainType">) => (s.chainType === "evm" ? s.address.toLowerCase() : s.address);

/** Short in-process cache of session status so every request doesn't hit the database. */
const statusCache = new Map<string, { ok: boolean; at: number }>();
const CACHE_MS = 15_000;

async function sidActive(sid: string, address: string): Promise<boolean> {
  const c = statusCache.get(sid);
  if (c && Date.now() - c.at < CACHE_MS) return c.ok;
  const row = (await q<{ address: string; revoked_at: string | null }>("select address, revoked_at from auth_sessions where sid=$1", [sid]))[0];
  const ok = !!row && !row.revoked_at && row.address === address;
  statusCache.set(sid, { ok, at: Date.now() });
  if (statusCache.size > 5000) statusCache.clear();
  return ok;
}

/** Issues a session after a verified signature. Call only from the verify route. */
export async function issueSession(res: NextResponse, secure: boolean, v: { address: string; chainType: Session["chainType"]; pq?: Session["pq"] }): Promise<Session> {
  const now = Date.now();
  const sid = randomBytes(18).toString("base64url");
  const session: Session = { address: v.address, chainType: v.chainType, exp: now + SESSION_TTL, iat: now, sid, ...(v.pq ? { pq: v.pq } : {}) };
  await q("insert into auth_sessions (sid, address, chain_type, pq, created_at, last_seen) values ($1,$2,$3,$4,now(),now())", [sid, norm(session), session.chainType, v.pq ? v.pq.fingerprint : null]);
  res.cookies.set(SESSION_COOKIE, seal(session, "session"), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_TTL / 1000 });
  return session;
}

/**
 * The verified session for this request, or null. Checks the seal, expiry and
 * the server-side record (not revoked, same address). Fails closed.
 */
export async function readSession(): Promise<Session | null> {
  const s = unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value, "session");
  if (!s?.sid || !s.address || !s.chainType) return null; // pre-gateway cookies have no record: sign in again
  try { return (await sidActive(s.sid, norm(s))) ? s : null; } catch { return null; }
}

/** Sliding renewal (keeps `iat`, so actions needing a recent signature still ask). Returns the session to report. */
export async function renewIfDue(res: NextResponse, secure: boolean, s: Session): Promise<Session> {
  const now = Date.now();
  const iat = s.iat ?? s.exp - SESSION_TTL;
  const limit = iat + SESSION_MAX_LIFETIME;
  if (!(s.exp - now < SESSION_TTL - RENEW_AFTER && s.exp < limit)) return s;
  const renewed: Session = { ...s, iat, exp: Math.min(now + SESSION_TTL, limit) };
  res.cookies.set(SESSION_COOKIE, seal(renewed, "session"), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: Math.floor((renewed.exp - now) / 1000) });
  await q("update auth_sessions set last_seen=now() where sid=$1", [s.sid]).catch(() => {});
  return renewed;
}

/** Ends this session (and optionally every session of the address) server-side and clears the cookie. */
export async function endSession(res: NextResponse, opts: { everywhere?: boolean } = {}) {
  const s = unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value, "session");
  if (s?.sid) {
    try {
      if (opts.everywhere) await q("update auth_sessions set revoked_at=now() where address=$1 and revoked_at is null", [norm(s)]);
      else await q("update auth_sessions set revoked_at=now() where sid=$1", [s.sid]);
    } catch { /* the cookie is still cleared below */ }
    statusCache.clear();
  }
  res.cookies.delete(SESSION_COOKIE);
}

/** Active sessions of the signed-in address (for "signed in on N devices"). */
export async function activeSessions(s: Session): Promise<number> {
  const r = await q<{ n: string | number }>("select count(*) as n from auth_sessions where address=$1 and revoked_at is null and last_seen > now() - interval '30 days'", [norm(s)]);
  return Number(r[0]?.n ?? 0);
}

/** Test helper */
export function __clearGatewayCache() { statusCache.clear(); }

import "server-only";
import { NextResponse } from "next/server";

/**
 * CSRF guard for state-changing requests. Browsers always send `Origin` on
 * cross-origin POSTs and `Sec-Fetch-Site` on modern engines; a mismatch means
 * another site is trying to act with the user's cookies. Non-browser clients
 * (no Origin, no Sec-Fetch-Site) are allowed — they don't carry the victim's
 * cookies.
 */
export function crossSiteRejection(req: Request): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    let oh: string | null = null;
    try { oh = new URL(origin).host; } catch { oh = null; }
    if (!oh || oh !== host) return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }
  return null;
}

/** Host the request was addressed to (behind Vercel's proxy too). */
export function requestHost(req: Request): string {
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
}

const g = globalThis as unknown as { __usedNonces?: Map<string, number> };
const used = (g.__usedNonces ??= new Map());

/**
 * Marks a sign-in nonce as consumed. Returns false if it was already used
 * (replay). Per-instance memory: combined with the 5-minute expiry and the
 * cookie being cleared on success, this blocks practical replays.
 */
export function consumeNonce(nonce: string, expiresAt: number): boolean {
  const now = Date.now();
  if (used.size > 50_000) for (const [k, exp] of used) if (exp < now) used.delete(k);
  if (used.has(nonce)) return false;
  used.set(nonce, expiresAt);
  return true;
}

/** Cookies are `Secure` everywhere except plain-HTTP local development. */
export function secureCookies(req: Request): boolean {
  if (new URL(req.url).protocol === "https:") return true;
  const h = requestHost(req);
  return !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h);
}

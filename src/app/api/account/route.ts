import { NextResponse } from "next/server";
import { z } from "zod";
import { q } from "@/lib/treasury/db";
import { crossSiteRejection } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { currentSession, profileForSession } from "@/lib/pro/profile";

/**
 * Bajar account = basic details attached to a wallet profile. Sign-up is
 * authenticated by the wallet's sign-in (Bajar Wallet: Ed25519 + ML-DSA-65);
 * there is no password and no key ever reaches the server.
 */
const Body = z.object({
  name: z.string().trim().min(2, "Name: at least 2 characters").max(40).regex(/^[\p{L}\p{N} .'_-]+$/u, "Name: letters, numbers, spaces and . ' _ - only"),
  email: z.string().trim().max(120).email("That email doesn't look right").optional().or(z.literal("")),
});

export async function GET() {
  const s = await currentSession();
  if (!s) return NextResponse.json({ account: null });
  try {
    const id = await profileForSession(s);
    const r = await q<{ display_name: string; email: string | null; created_at: string }>("select display_name, email, created_at from accounts where profile_id = $1", [id]);
    return NextResponse.json({ account: r[0] ? { name: r[0].display_name, email: r[0].email, createdAt: r[0].created_at } : null }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ account: null, error: "Accounts unavailable right now." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`acct:${clientIp(req)}`, 10, 10);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Invalid details" }, { status: 400 });
  try {
    const id = await profileForSession(s);
    await q(
      `insert into accounts (profile_id, display_name, email) values ($1,$2,$3)
       on conflict (profile_id) do update set display_name = excluded.display_name, email = excluded.email, updated_at = now()`,
      [id, p.data.name, p.data.email ? p.data.email.toLowerCase() : null],
    );
    return NextResponse.json({ ok: true, account: { name: p.data.name, email: p.data.email || null } });
  } catch {
    return NextResponse.json({ error: "Couldn't save right now." }, { status: 503 });
  }
}

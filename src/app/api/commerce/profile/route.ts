import { NextResponse } from "next/server";
import { cleanProfile, deleteShoppingProfile, getShoppingProfile, ProfileError, saveShoppingProfile } from "@/lib/commerce/profile";
import { currentSession, profileForSession } from "@/lib/pro/profile";
import { crossSiteRejection } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

const noStore = { "cache-control": "no-store" };

async function owner() {
  const s = await currentSession();
  return s ? profileForSession(s) : null;
}

/** The signed-in owner's shopping profile (decrypted for them only). */
export async function GET() {
  try {
    const id = await owner();
    if (!id) return NextResponse.json({ error: "Sign in with your wallet to use your shopping profile." }, { status: 401, headers: noStore });
    return NextResponse.json({ profile: await getShoppingProfile(id) }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Profiles are unavailable right now." }, { status: 503, headers: noStore });
  }
}

export async function PUT(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const rl = rateLimit(`sp:${clientIp(req)}`, 20, 20);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    const id = await owner();
    if (!id) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
    const p = cleanProfile((await req.json().catch(() => null))?.profile);
    await saveShoppingProfile(id, p);
    return NextResponse.json({ profile: p }, { headers: noStore });
  } catch (e) {
    if (e instanceof ProfileError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Profiles are unavailable right now." }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  try {
    const id = await owner();
    if (!id) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
    await deleteShoppingProfile(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Profiles are unavailable right now." }, { status: 503 });
  }
}

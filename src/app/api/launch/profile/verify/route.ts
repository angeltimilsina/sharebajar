import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { unseal, verifyEvm, verifySolana } from "@/lib/server/auth";
import { consumeNonce, crossSiteRejection, requestHost } from "@/lib/server/guard";
import { saveProfile, type ProfileFields } from "@/lib/launch/profile";

interface Pending { message: string; nonce: string; host: string; chain: string; token: string; creator: string; fields: ProfileFields; exp: number }

/** Saves the profile once the creator's signature checks out. */
export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const pending = unseal<Pending>((await cookies()).get("sb_tprof")?.value, "link");
  if (!pending || pending.host !== requestHost(req)) return NextResponse.json({ error: "Request expired. Try again." }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { signature?: string } | null;
  const sig = b?.signature;
  if (!sig || typeof sig !== "string" || sig.length > 200) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const ok = pending.chain === "solana" ? verifySolana(pending.message, sig, pending.creator) : verifyEvm(pending.message, sig, pending.creator);
  if (!ok) return NextResponse.json({ error: "Only the wallet that launched this token can edit its profile." }, { status: 401 });
  if (!consumeNonce(pending.nonce, pending.exp)) return NextResponse.json({ error: "This request was already used." }, { status: 409 });
  try {
    await saveProfile(pending.chain, pending.token, pending.fields, pending.creator);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete({ name: "sb_tprof", path: "/api/launch/profile" });
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't save right now." }, { status: 503 });
  }
}

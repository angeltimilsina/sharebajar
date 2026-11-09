import { NextResponse } from "next/server";
import { crossSiteRejection } from "@/lib/server/guard";
import { currentSession, profileForSession, unlinkWallet } from "@/lib/pro/profile";

/** Remove a linked wallet from the signed-in profile. */
export async function DELETE(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!/^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/.test(address)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  const r = await unlinkWallet(await profileForSession(s), address, s.address);
  return NextResponse.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : 400 });
}

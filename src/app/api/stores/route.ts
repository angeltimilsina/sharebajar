import { NextResponse } from "next/server";
import { disconnectStore, storeAccounts, storeConnectors } from "@/lib/commerce/profile";
import { currentSession, profileForSession } from "@/lib/pro/profile";
import { crossSiteRejection } from "@/lib/server/guard";

/** Store sign-in options and the signed-in owner's connected store accounts. */
export async function GET() {
  const connectors = storeConnectors().map(({ id, name, configured, missing, grants }) => ({ id, name, configured, missing, grants }));
  const s = await currentSession().catch(() => null);
  if (!s) return NextResponse.json({ connectors, accounts: [], signedIn: false }, { headers: { "cache-control": "no-store" } });
  try {
    return NextResponse.json({ connectors, accounts: await storeAccounts(await profileForSession(s)), signedIn: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ connectors, accounts: [], signedIn: true, error: "Store accounts are unavailable right now." }, { headers: { "cache-control": "no-store" } });
  }
}

export async function DELETE(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return blocked;
  const store = new URL(req.url).searchParams.get("store") ?? "";
  if (!/^(amazon|ebay)$/.test(store)) return NextResponse.json({ error: "Unknown store" }, { status: 400 });
  const s = await currentSession().catch(() => null);
  if (!s) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
  try {
    await disconnectStore(await profileForSession(s), store);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Store accounts are unavailable right now." }, { status: 503 });
  }
}

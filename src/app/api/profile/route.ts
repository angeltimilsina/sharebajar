import { NextResponse } from "next/server";
import { PRO, currentSession, planOf, proRecipient, profileForSession, walletsOf } from "@/lib/pro/profile";

/** The signed-in wallet's profile: linked wallets, plan, limits and Pro pricing. */
export async function GET() {
  const pricing = { priceUsdc: PRO.priceUsdc, periodDays: PRO.periodDays, linkLimit: PRO.linkLimit, recipient: await proRecipient(), token: "USDC", chain: "solana" };
  const s = await currentSession();
  if (!s) return NextResponse.json({ signedIn: false, pricing }, { headers: { "cache-control": "no-store" } });
  try {
    const id = await profileForSession(s);
    const [wallets, plan] = await Promise.all([walletsOf(id), planOf(id)]);
    return NextResponse.json({ signedIn: true, address: s.address, profile: { id, wallets: wallets.map((w) => ({ address: w.address, chainType: w.chain_type, label: w.label, verifiedAt: w.verified_at })), plan }, pricing }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ signedIn: true, address: s.address, error: "Profiles are unavailable right now.", detail: String(e).slice(0, 120), pricing }, { status: 503 });
  }
}

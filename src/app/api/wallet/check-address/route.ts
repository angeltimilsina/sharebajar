import { NextResponse } from "next/server";
import { addressRisk } from "@/lib/bajar/server/addressRisk";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

/** GET ?network=ethereum&address=0x… — recipient screening for Bajar Wallet sends. */
export async function GET(req: Request) {
  const rl = rateLimit(`risk:${clientIp(req)}`, 30, 30);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const u = new URL(req.url);
  const network = (u.searchParams.get("network") ?? "").slice(0, 20), address = (u.searchParams.get("address") ?? "").trim().slice(0, 100);
  if (!network || !address) return NextResponse.json({ error: "network and address are required" }, { status: 400 });
  try {
    return NextResponse.json(await addressRisk(network, address), { headers: { "cache-control": "private, max-age=60" } });
  } catch (e) {
    return NextResponse.json({ error: `Address check unavailable: ${String(e instanceof Error ? e.message : e).slice(0, 120)}` }, { status: 502 });
  }
}

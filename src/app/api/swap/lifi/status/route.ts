import { NextResponse } from "next/server";
import { LIFI_CHAIN, lifiStatus } from "@/lib/trading/lifi";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const txHash = u.searchParams.get("txHash") ?? "", from = u.searchParams.get("fromNetwork") ?? "", to = u.searchParams.get("toNetwork") ?? "";
  if (!txHash || !LIFI_CHAIN[from] || !LIFI_CHAIN[to]) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try { return NextResponse.json(await lifiStatus(txHash, from, to), { headers: { "cache-control": "no-store" } }); }
  catch (e) { return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 502 }); }
}

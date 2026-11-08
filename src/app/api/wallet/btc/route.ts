import { NextResponse } from "next/server";
import { btcBroadcast, btcFees, btcSummary, btcTxStatus, btcUtxos, isMainnetBtcAddress } from "@/lib/bajar/server/bitcoin";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const op = u.searchParams.get("op");
  const address = u.searchParams.get("address") ?? "";
  try {
    if (op === "fees") return NextResponse.json((await btcFees()).data);
    if (op === "status") {
      const txid = u.searchParams.get("txid") ?? "";
      if (!/^[0-9a-f]{64}$/.test(txid)) return NextResponse.json({ error: "Invalid txid" }, { status: 400 });
      return NextResponse.json(await btcTxStatus(txid));
    }
    if (!isMainnetBtcAddress(address)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    if (op === "utxos") return NextResponse.json(await btcUtxos(address), { headers: { "cache-control": "no-store" } });
    const s = await btcSummary(address);
    return NextResponse.json({ ...s.data, fetchedAt: s.fetchedAt, stale: s.stale });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 502 });
  }
}

/** Broadcast an already-signed transaction (the server never sees keys). */
export async function POST(req: Request) {
  const rl = rateLimit(`btcb:${clientIp(req)}`, 10, 10);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const b = (await req.json().catch(() => null)) as { hex?: string } | null;
  try {
    const txid = await btcBroadcast(String(b?.hex ?? ""));
    return NextResponse.json({ txid: txid.trim() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 400 });
  }
}

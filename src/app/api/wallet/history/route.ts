import { NextResponse } from "next/server";
import { srpc } from "@/lib/treasury/solana";

/** Solana signature history for an address (EVM history requires an indexer; see wallet UI). */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("solana") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  try {
    const sigs = await srpc<{ signature: string; blockTime: number | null; err: unknown; confirmationStatus: string | null; memo: string | null }[]>("getSignaturesForAddress", [address, { limit: 25 }]);
    return NextResponse.json({ solana: sigs.map((s) => ({ signature: s.signature, time: s.blockTime ? s.blockTime * 1000 : null, failed: !!s.err, status: s.confirmationStatus })) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 502 });
  }
}

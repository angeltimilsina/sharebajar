import { NextResponse } from "next/server";
import { feeCandidates } from "@/lib/treasury/service";
import { CHAINS } from "@/lib/chains";

/** Public fee transparency: which networks currently charge a platform fee, and how much. */
export async function GET() {
  const out = [];
  for (const c of CHAINS) {
    try {
      const cands = (await feeCandidates(c.id)).filter((x) => x.status === "active");
      out.push({ chain: c.id, active: cands.length > 0, fees: cands.map((x) => ({ mode: x.mode, bps: x.bps, tokens: x.tokens.map((t) => t.symbol) })) });
    } catch {
      out.push({ chain: c.id, active: false, fees: [] });
    }
  }
  return NextResponse.json({ networks: out }, { headers: { "cache-control": "public, s-maxage=30" } });
}

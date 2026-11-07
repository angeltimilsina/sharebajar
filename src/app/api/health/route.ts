import { getHostStats } from "@/lib/server/http";
import { aiConfigured } from "@/lib/ai/config";
import { NextResponse } from "next/server";

/** Integration status for monitoring dashboards and the /status page. */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      time: Date.now(),
      uptimeSec: Math.round(process.uptime()),
      integrations: {
        ai: { configured: aiConfigured(), provider: "Anthropic" },
        coingeckoKey: Boolean(process.env.COINGECKO_API_KEY),
        solanaRpc: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ? "custom" : "public (rate-limited)",
        evmSwaps: { configured: false, note: "EVM swap routing not yet integrated" },
        limitOrders: { configured: false, note: "Limit orders not yet integrated" },
      },
      upstreams: getHostStats(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

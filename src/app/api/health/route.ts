import { getHostStats } from "@/lib/server/http";
import { aiConfigured } from "@/lib/ai/config";
import { NextResponse } from "next/server";
import { feeCandidates, treasuryStatus } from "@/lib/treasury/service";
import { dbHealth } from "@/lib/treasury/db";

/** Integration status for monitoring dashboards and the /status page. */
export async function GET() {
  // Which networks currently charge a platform fee (no addresses exposed).
  const feeNetworks: string[] = [];
  for (const chain of ["solana", "ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche"]) {
    if ((await feeCandidates(chain).catch(() => [])).some((c) => c.status === "active")) feeNetworks.push(chain);
  }
  const store = treasuryStatus();
  const database = await dbHealth();
  return NextResponse.json(
    {
      status: "ok",
      time: Date.now(),
      uptimeSec: Math.round(process.uptime()),
      integrations: {
        ai: { configured: aiConfigured(), provider: "Anthropic" },
        database,
        marketData: "CoinLore + Binance (keyless)",
        networks: "mempool.space + public JSON-RPC",
        solanaRpc: process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL ? "custom" : "public (rate-limited)",
        treasury: store
          ? { configured: false, note: `Platform fees off: ${store}. Set DATABASE_URL to enable the treasury.` }
          : { configured: true, feeNetworks, note: feeNetworks.length ? `Platform fees active on ${feeNetworks.join(", ")}` : "No active treasury: swaps run with no platform fee" },
        evmSwaps: { configured: !!process.env.ZEROX_API_KEY, note: process.env.ZEROX_API_KEY ? "0x Swap API" : "ZEROX_API_KEY not set" },
        limitOrders: { configured: false, note: "Limit orders not yet integrated" },
      },
      upstreams: getHostStats(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

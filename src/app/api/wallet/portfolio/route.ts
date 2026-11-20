import { NextResponse } from "next/server";
import { z } from "zod";
import { portfolio } from "@/lib/bajar/server/portfolio";
import { isMainnetBtcAddress } from "@/lib/bajar/server/bitcoin";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

const Custom = z.array(z.object({ network: z.string().max(20), token: z.string().min(32).max(64), symbol: z.string().max(16), decimals: z.number().int().min(0).max(36) })).max(30);

/** Live multi-chain holdings for public addresses. */
export async function GET(req: Request) {
  const rl = rateLimit(`pf:${clientIp(req)}`, 30, 30);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const u = new URL(req.url);
  const btc = u.searchParams.get("btc") || undefined, evm = u.searchParams.get("evm") || undefined, solana = u.searchParams.get("sol") || undefined;
  if (btc && !isMainnetBtcAddress(btc)) return NextResponse.json({ error: "Invalid BTC address" }, { status: 400 });
  if (evm && !/^0x[0-9a-fA-F]{40}$/.test(evm)) return NextResponse.json({ error: "Invalid EVM address" }, { status: 400 });
  if (solana && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solana)) return NextResponse.json({ error: "Invalid Solana address" }, { status: 400 });
  let custom: z.infer<typeof Custom> = [];
  try { custom = Custom.parse(JSON.parse(u.searchParams.get("custom") ?? "[]")); } catch { return NextResponse.json({ error: "Invalid custom tokens" }, { status: 400 }); }
  try {
    const env = await portfolio({ btc, evm, solana }, custom);
    return NextResponse.json(env, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}

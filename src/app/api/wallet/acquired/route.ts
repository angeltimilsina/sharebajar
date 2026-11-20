import { NextResponse } from "next/server";
import { acquired } from "@/lib/bajar/server/acquired";
import { isMainnetBtcAddress } from "@/lib/bajar/server/bitcoin";
import { getChain } from "@/lib/chains";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

/** First-received date (and the market price that day) for one asset in one public address. */
export async function GET(req: Request) {
  const rl = rateLimit(`acq:${clientIp(req)}`, 30, 20);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const u = new URL(req.url);
  const chain = u.searchParams.get("chain");
  const network = u.searchParams.get("network") ?? "";
  const address = u.searchParams.get("address") ?? "";
  const token = u.searchParams.get("token") ?? "";
  const symbol = (u.searchParams.get("symbol") ?? "").slice(0, 16);
  if (chain === "solana") {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) || !/^([1-9A-HJ-NP-Za-km-z]{32,44}|native)$/.test(token)) return NextResponse.json({ error: "Invalid Solana address or token" }, { status: 400 });
  } else if (chain === "evm") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !/^(0x[0-9a-fA-F]{40}|native)$/.test(token) || getChain(network)?.type !== "evm") return NextResponse.json({ error: "Invalid EVM address, token or network" }, { status: 400 });
  } else if (chain === "bitcoin") {
    if (!isMainnetBtcAddress(address)) return NextResponse.json({ error: "Invalid BTC address" }, { status: 400 });
  } else return NextResponse.json({ error: "Unknown chain" }, { status: 400 });
  try {
    const data = await acquired(chain, chain === "bitcoin" ? "bitcoin" : chain === "solana" ? "solana" : network, address, token, symbol);
    return NextResponse.json({ data }, { headers: { "cache-control": "private, max-age=600" } });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 502 });
  }
}

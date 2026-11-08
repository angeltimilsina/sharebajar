import { NextResponse } from "next/server";
import { adapterFor } from "@/lib/treasury/adapters";
import { getChain } from "@/lib/chains";

/** Validate a custom token on-chain before adding it to BAJAR Wallet. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const network = u.searchParams.get("network") ?? "", token = (u.searchParams.get("token") ?? "").trim();
  if (!getChain(network)) return NextResponse.json({ error: "Unsupported network" }, { status: 400 });
  const a = adapterFor(network);
  if (!a.validAddress(token)) return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  try {
    const info = await a.tokenInfo(network, token, "mainnet");
    if (!info) return NextResponse.json({ error: "Not a valid token contract/mint on this network." }, { status: 404 });
    return NextResponse.json({ network, token, symbol: info.symbol, decimals: info.decimals });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 502 });
  }
}

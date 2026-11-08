import { NextResponse } from "next/server";
import { listTreasuries } from "@/lib/treasury/store";

/** Launch settings: disclosed fee (USDC) and where it goes; whether metadata hosting is available. */
export async function GET() {
  const feeUsdc = Math.max(0, Number(process.env.TOKEN_LAUNCH_FEE_USDC ?? 0)) || 0;
  let recipient: string | null = null;
  let hosting = true;
  try {
    // The fee is only charged if an active, verified Solana treasury exists to receive it.
    const t = (await listTreasuries()).find((x) => x.chain === "solana" && x.status === "active" && x.integrityOk && x.ownership && x.environment === "mainnet" && x.kind !== "jupiter_referral");
    recipient = t?.address ?? null;
  } catch { hosting = false; }
  const fee = feeUsdc > 0 && recipient ? { amountUsdc: feeUsdc, recipient } : null;
  return NextResponse.json({ fee, metadataHosting: hosting, chains: ["solana"] }, { headers: { "cache-control": "no-store" } });
}

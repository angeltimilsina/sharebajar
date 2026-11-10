import { NextResponse } from "next/server";
import { LAUNCH_NETWORKS, launchFeePlan, type LaunchNetwork } from "@/lib/launch/fees";

/**
 * Launch settings for the selected networks (?networks=solana,base): the fee
 * schedule, what is actually charged on each network and where it goes.
 * Metadata is hosted in the database, or stored in the URL itself without one.
 */
export async function GET(req: Request) {
  const asked = (new URL(req.url).searchParams.get("networks") ?? "solana").split(",").filter((n): n is LaunchNetwork => (LAUNCH_NETWORKS as readonly string[]).includes(n));
  const plan = await launchFeePlan(asked.length ? asked : ["solana"]);
  const sol = plan.networks.find((n) => n.network === "solana");
  // `fee` keeps the single-network Solana shape the launcher reads.
  const fee = sol && sol.recipient ? { amountUsdc: sol.feeUsd, recipient: sol.recipient } : null;
  return NextResponse.json({ ...plan, fee, metadataHosting: true, chains: LAUNCH_NETWORKS }, { headers: { "cache-control": "no-store" } });
}

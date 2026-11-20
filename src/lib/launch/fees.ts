import "server-only";
import { listTreasuries } from "@/lib/treasury/store";
import { priceAt } from "@/lib/treasury/prices";
import { q } from "@/lib/treasury/db";

export interface LaunchFeeSettings { schedule: number[] | null; solanaRecipient: string | null; evmRecipient: string | null; updatedBy?: string; updatedAt?: string }

/** Owner-set fee settings (admin dashboard), falling back to the environment. */
export async function launchFeeSettings(): Promise<LaunchFeeSettings> {
  let row: { schedule: string | null; solana_recipient: string | null; evm_recipient: string | null; updated_by: string; updated_at: string } | undefined;
  try { row = (await q<NonNullable<typeof row>>("select schedule, solana_recipient, evm_recipient, updated_by, updated_at from launch_fee_settings where id = 'default'"))[0]; } catch { /* no database */ }
  const sched = row?.schedule ? parseSchedule(row.schedule) : null;
  return {
    schedule: sched,
    solanaRecipient: row?.solana_recipient || process.env.LAUNCH_FEE_RECIPIENT_SOLANA || null,
    evmRecipient: row?.evm_recipient || process.env.LAUNCH_FEE_RECIPIENT_EVM || null,
    updatedBy: row?.updated_by, updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}

export function parseSchedule(raw: string): number[] | null {
  const v = raw.split(",").map((x) => Number(x.trim()));
  return v.length === 4 && v.every((x, i) => Number.isFinite(x) && x >= 0 && x <= 10_000 && (i === 0 || x >= v[i - 1])) ? v : null;
}

/**
 * Launch fees grow with the number of networks a token launches on.
 * LAUNCH_FEES_USDC (or the admin setting) lists the TOTAL fee for 1, 2, 3 and 4 networks
 * (default 1, 2, 3, 4: 1 USDC per network). The total is split evenly across the selected
 * networks and each share is paid on that network, in that launch:
 *  - Solana: USDC inside the launch transaction, to the active Solana treasury.
 *  - Ethereum / Base / BNB Chain: the native coin at the live price, to that
 *    network's active treasury, in a transfer signed just before the deploy.
 * Fees go to the network's active, verified treasury, or else to the fee
 * address an owner set in the admin dashboard (launch_fee_settings). With
 * neither, that network charges nothing. Every amount is shown before signing.
 */
export const LAUNCH_NETWORKS = ["solana", "ethereum", "base", "bsc"] as const;
export type LaunchNetwork = (typeof LAUNCH_NETWORKS)[number];
const NATIVE: Record<Exclude<LaunchNetwork, "solana">, string> = { ethereum: "ETH", base: "ETH", bsc: "BNB" };

export function feeSchedule(): number[] {
  return parseSchedule(process.env.LAUNCH_FEES_USDC ?? "") ?? [1, 2, 3, 4];
}

export interface NetworkFee {
  network: LaunchNetwork;
  feeUsd: number;
  /** null: no active treasury on this network, so nothing is charged there. */
  recipient: string | null;
  token: "USDC" | "ETH" | "BNB";
  /** Smallest units: USDC 6 decimals; native coins 18 decimals (wei). */
  amountRaw: string;
  display: string;
}

export async function launchFeePlan(selected: LaunchNetwork[]) {
  const settings = await launchFeeSettings();
  const schedule = settings.schedule ?? feeSchedule();
  const nets = LAUNCH_NETWORKS.filter((n) => selected.includes(n));
  const totalUsd = nets.length ? schedule[nets.length - 1] : 0;
  const share = nets.length ? Math.floor((totalUsd / nets.length) * 100) / 100 : 0;
  let treasuries: Awaited<ReturnType<typeof listTreasuries>> = [];
  try { treasuries = await listTreasuries(); } catch { /* no database: no fees */ }
  // Prefer the network's active, verified treasury; otherwise the fee address an owner set in the admin dashboard.
  const recipientFor = (n: LaunchNetwork) => treasuries.find((t) => t.chain === n && t.status === "active" && t.integrityOk && t.ownership && t.environment === "mainnet" && t.kind !== "jupiter_referral")?.address
    ?? (n === "solana" ? settings.solanaRecipient : settings.evmRecipient) ?? null;

  const networks: NetworkFee[] = await Promise.all(nets.map(async (n): Promise<NetworkFee> => {
    const recipient = share > 0 ? recipientFor(n) : null;
    if (n === "solana") {
      return { network: n, feeUsd: recipient ? share : 0, recipient, token: "USDC", amountRaw: recipient ? String(Math.round(share * 1e6)) : "0", display: recipient ? `${share} USDC` : "None" };
    }
    const sym = NATIVE[n];
    if (!recipient) return { network: n, feeUsd: 0, recipient: null, token: sym as "ETH" | "BNB", amountRaw: "0", display: "None" };
    const p = await priceAt(n, "native", sym, Date.now());
    // Only charge with a live market price; otherwise skip rather than guess.
    if (!p.price || !p.source.startsWith("Binance")) return { network: n, feeUsd: 0, recipient: null, token: sym as "ETH" | "BNB", amountRaw: "0", display: "None (price unavailable)" };
    const wei = BigInt(Math.ceil((share / p.price) * 1e9)) * BigInt(1e9);
    return { network: n, feeUsd: share, recipient, token: sym as "ETH" | "BNB", amountRaw: wei.toString(), display: `${share} USDC ≈ ${(Number(wei) / 1e18).toFixed(6)} ${sym}` };
  }));
  return { schedule, totalUsd, chargedUsd: Math.round(networks.reduce((s, x) => s + x.feeUsd, 0) * 100) / 100, networks };
}

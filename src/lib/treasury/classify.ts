/**
 * Pure classification + reconciliation rules (unit-tested).
 * Revenue is counted only from fees that actually arrived on-chain.
 */
export type Source = "swap_fee" | "referral_fee" | "launchpad_fee" | "transfer_in" | "transfer_out";

export interface ClassifyInput {
  direction: "in" | "out";
  isFeeAccount: boolean;          // received into a configured fee / referral token account
  treasuryKind: string;
  intent: { mode: string; expectedFee: string | null; slippageBps: number | null; providerShareBps: number } | null;
  swapProgramInvoked: boolean;    // Jupiter program (Solana) or 0x AllowanceHolder/Settler (EVM) in the tx
  txFailed: boolean;
}

export interface Classification { source: Source; isRevenue: boolean; attribution: "intent" | "unattributed" | "none" }

export function classify(i: ClassifyInput): Classification {
  if (i.txFailed) return { source: i.direction === "in" ? "transfer_in" : "transfer_out", isRevenue: false, attribution: "none" };
  if (i.direction === "out") return { source: "transfer_out", isRevenue: false, attribution: "none" };
  const feeSource: Source = i.treasuryKind === "jupiter_referral" || i.intent?.mode === "referral" ? "referral_fee" : "swap_fee";
  if (i.intent && i.intent.mode !== "none" && i.isFeeAccount) return { source: feeSource, isRevenue: true, attribution: "intent" };
  // Fee arriving through the swap program into a fee account (e.g. a swap that
  // used our fee account but wasn't reported back by the browser) is genuine revenue.
  if (i.isFeeAccount && i.swapProgramInvoked) return { source: feeSource, isRevenue: true, attribution: "unattributed" };
  // Anything else (deposits, internal moves, airdrops) is a transfer, not revenue.
  return { source: "transfer_in", isRevenue: false, attribution: "none" };
}

/** Gross fee charged and provider share, given the net amount received. */
export function splitProviderShare(netRaw: bigint, providerShareBps: number): { gross: bigint; share: bigint } {
  if (!providerShareBps) return { gross: netRaw, share: BigInt(0) };
  const gross = (netRaw * BigInt(10_000)) / BigInt(10_000 - providerShareBps);
  return { gross, share: gross - netRaw };
}

export type Recon = "matched" | "over" | "under" | "unexpected" | "not_applicable";

/** Compare actual vs expected; fees scale with executed output, so allow slippage + 1%. */
export function reconcile(actualRaw: bigint, expectedRaw: bigint | null, slippageBps: number | null, isRevenue: boolean, attributed: boolean): Recon {
  if (!isRevenue) return "not_applicable";
  if (!attributed) return "unexpected";
  if (expectedRaw === null || expectedRaw === BigInt(0)) return "matched";
  const tolBps = BigInt((slippageBps ?? 50) + 100);
  const lo = (expectedRaw * (BigInt(10_000) - tolBps)) / BigInt(10_000);
  const hi = (expectedRaw * (BigInt(10_000) + tolBps)) / BigInt(10_000);
  if (actualRaw < lo) return "under";
  if (actualRaw > hi) return "over";
  return "matched";
}

/** Raw integer units → decimal string without float error. */
export function toDecimal(raw: bigint, decimals: number): string {
  const neg = raw < BigInt(0);
  const s = (neg ? -raw : raw).toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals) || "0";
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

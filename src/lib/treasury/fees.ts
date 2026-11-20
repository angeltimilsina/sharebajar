import { sameToken } from "./tokens";

/**
 * Fee policy. Defaults to 30 bps (PLATFORM_FEE_BPS) but each provider has its
 * own rules — never assume one rate fits all:
 *  - Jupiter /build platform fee: any bps, taken from the OUTPUT token into our
 *    token account for that mint (verified live: 30 bps ⇒ 0.30% of output).
 *  - Jupiter /order referral fee: 50–255 bps only; Jupiter keeps 20%; Jupiter
 *    picks the fee mint (SOL > stables > LSTs > bluechips > others).
 *  - 0x integrator fee: 0–1000 bps, paid in buyToken or sellToken.
 */
export const DEFAULT_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? 30);
export const MAX_FEE_BPS = Number(process.env.TREASURY_MAX_FEE_BPS ?? 100);

/**
 * Token launch fee (USDC), set with TOKEN_LAUNCH_FEE_USDC. Charged inside the
 * launch transaction (disclosed before signing) only when an active, verified
 * Solana treasury exists to receive it; otherwise no fee is taken.
 */
const launchAmount = Number(process.env.TOKEN_LAUNCH_FEE_USDC ?? 0);
export const LAUNCH_FEE = {
  enabled: launchAmount > 0,
  amountUsdc: launchAmount,
  note: launchAmount > 0 ? `${launchAmount} USDC per token launch, shown to the creator before signing and paid to the active Solana treasury.` : "No token launch fee configured.",
};

export const PROVIDER_RULES = {
  "jupiter:platform": { min: 1, max: 1000, providerShareBps: 0, label: "Jupiter Swap V2 /build platform fee" },
  "jupiter:referral": { min: 50, max: 255, providerShareBps: 2000, label: "Jupiter Swap V2 /order referral fee" },
  "0x:integrator": { min: 1, max: 1000, providerShareBps: 0, label: "0x Swap API integrator fee" },
  // LI.FI may keep a share depending on volume/plan; the quote's feeSplit is authoritative.
  "lifi:cross_chain": { min: 1, max: 300, providerShareBps: 0, label: "LI.FI cross-chain integrator fee" },
} as const;
export type RuleKey = keyof typeof PROVIDER_RULES;

export function checkFeeBps(key: RuleKey, bps: number): string | null {
  const r = PROVIDER_RULES[key];
  if (!Number.isInteger(bps)) return "Fee must be a whole number of basis points.";
  if (bps < r.min || bps > r.max) return `${r.label} must be between ${r.min} and ${r.max} bps (requested ${bps}).`;
  if (bps > MAX_FEE_BPS) return `Fee exceeds the platform cap of ${MAX_FEE_BPS} bps (TREASURY_MAX_FEE_BPS).`;
  return null;
}

export interface FeeCandidate {
  treasuryId: string;
  status: string;
  mode: "platform" | "referral" | "integrator";
  bps: number;
  preferUsdc?: boolean;
  tokens: { token: string; symbol: string; decimals: number; account: string; initialized?: boolean }[];
  referralAccount?: string;
}

export type FeeDecision =
  | { applied: true; treasuryId: string; mode: FeeCandidate["mode"]; bps: number; providerShareBps: number; token: string | null; symbol: string | null; decimals: number | null; recipient: string; isTest: boolean }
  | { applied: false; reason: string };

/** "testing" treasuries only charge fees on swaps made by admin wallets (test swaps). */
function usable(c: FeeCandidate, takerIsAdmin: boolean) {
  return c.status === "active" || (c.status === "testing" && takerIsAdmin);
}

export function selectSolanaFee(cands: FeeCandidate[], outputMint: string, takerIsAdmin: boolean): FeeDecision {
  const live = cands.filter((c) => usable(c, takerIsAdmin));
  if (!live.length) return { applied: false, reason: "Platform fee collection is not active on Solana." };
  const referral = live.find((c) => c.mode === "referral");
  if (referral) {
    return { applied: true, treasuryId: referral.treasuryId, mode: "referral", bps: referral.bps, providerShareBps: PROVIDER_RULES["jupiter:referral"].providerShareBps, token: null, symbol: null, decimals: null, recipient: referral.referralAccount!, isTest: referral.status === "testing" };
  }
  for (const c of live.filter((x) => x.mode === "platform")) {
    const tok = c.tokens.find((t) => sameToken(t.token, outputMint) && t.initialized !== false);
    if (tok) return { applied: true, treasuryId: c.treasuryId, mode: "platform", bps: c.bps, providerShareBps: 0, token: tok.token, symbol: tok.symbol, decimals: tok.decimals, recipient: tok.account, isTest: c.status === "testing" };
  }
  return { applied: false, reason: "No platform fee: the output token is not an enabled fee token." };
}

export function selectEvmFee(cands: FeeCandidate[], sellToken: string, buyToken: string, takerIsAdmin: boolean): FeeDecision {
  const live = cands.filter((c) => usable(c, takerIsAdmin));
  if (!live.length) return { applied: false, reason: "Platform fee collection is not active on this network." };
  for (const c of live) {
    // Prefer the buy token, then the sell token. Native ETH is never used: fees
    // must arrive as ERC-20 Transfer events so they can be verified on-chain.
    const pair = c.tokens.filter((t) => sameToken(t.token, buyToken) || sameToken(t.token, sellToken));
    // USDC preferred (stable accounting) when enabled and one side is USDC; then buy token, then sell token.
    const tok = (c.preferUsdc !== false ? pair.find((t) => t.symbol.toUpperCase() === "USDC") : undefined)
      ?? c.tokens.find((t) => sameToken(t.token, buyToken)) ?? c.tokens.find((t) => sameToken(t.token, sellToken));
    if (tok) return { applied: true, treasuryId: c.treasuryId, mode: "integrator", bps: c.bps, providerShareBps: 0, token: tok.token, symbol: tok.symbol, decimals: tok.decimals, recipient: tok.account, isTest: c.status === "testing" };
  }
  return { applied: false, reason: "No platform fee: neither token is an enabled fee token on this network." };
}

/** Jupiter /build: outAmount is already net of the platform fee. */
export const platformFeeFromNetOut = (netOut: bigint, bps: number) => (netOut * BigInt(bps)) / BigInt(10_000 - bps);
export const feeFromGross = (gross: bigint, bps: number) => (gross * BigInt(bps)) / BigInt(10_000);

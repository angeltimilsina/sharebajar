import "server-only";
import bs58 from "bs58";
import { AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { fetchUpstream } from "../server/http";
import { srpc } from "../treasury/solana";

/**
 * Jupiter Swap API V2 (https://api.jup.ag/swap/v2).
 *  - /build  → raw instructions, no Jupiter swap fee; integrator platform fee via
 *              platformFeeBps + feeAccount (fee deducted from the output token).
 *  - /order  → managed route + transaction; referral fee via referralAccount +
 *              referralFee (50–255 bps), Jupiter keeps 20%; landed via /execute.
 * Docs: https://developers.jup.ag/docs/swap
 */
const BASE = "https://api.jup.ag/swap/v2";
const headers = (): Record<string, string> => (process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {});
/** /build needs a taker; for wallet-less quotes we use a configurable placeholder. */
export const QUOTE_TAKER = process.env.JUPITER_QUOTE_TAKER || "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

interface ApiIx { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }
export interface BuildResponse {
  inputMint: string; outputMint: string; inAmount: string; outAmount: string; otherAmountThreshold: string; swapMode: string; slippageBps: number; priceImpactPct: string;
  routePlan: { bps: number; swapInfo: { label: string; inputMint: string; outputMint: string } }[];
  computeBudgetInstructions: ApiIx[]; setupInstructions: ApiIx[]; swapInstruction: ApiIx; cleanupInstruction: ApiIx | null; otherInstructions: ApiIx[];
  addressesByLookupTableAddress: Record<string, string[]> | null;
  blockhashWithMetadata: { blockhash: number[]; lastValidBlockHeight: number };
}

export interface BuildParams { inputMint: string; outputMint: string; amount: string; slippageBps: number; taker: string; platformFeeBps?: number; feeAccount?: string }

export async function v2Build(p: BuildParams): Promise<BuildResponse> {
  const qs = new URLSearchParams({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount, taker: p.taker, slippageBps: String(p.slippageBps) });
  if (p.platformFeeBps && p.feeAccount) { qs.set("platformFeeBps", String(p.platformFeeBps)); qs.set("feeAccount", p.feeAccount); }
  return fetchUpstream<BuildResponse>(`${BASE}/build?${qs}`, { headers: headers(), retries: 0, timeoutMs: 12_000 });
}

export interface OrderResponse {
  mode: string; router: string; swapType?: string; inAmount: string; outAmount: string; otherAmountThreshold?: string; priceImpactPct?: string; priceImpact?: number;
  feeBps: number; feeMint: string; platformFee?: { amount?: string; feeBps: number; feeMint?: string }; referralAccount: string | null;
  transaction: string | null; requestId: string; slippageBps?: number; routePlan?: { swapInfo: { label: string } }[]; errorCode?: number; errorMessage?: string; error?: string;
}

export async function v2Order(p: { inputMint: string; outputMint: string; amount: string; taker?: string; slippageBps?: number; referralAccount?: string; referralFee?: number }): Promise<OrderResponse> {
  const qs = new URLSearchParams({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount });
  if (p.taker) qs.set("taker", p.taker);
  if (p.slippageBps) qs.set("slippageBps", String(p.slippageBps));
  if (p.referralAccount && p.referralFee) { qs.set("referralAccount", p.referralAccount); qs.set("referralFee", String(p.referralFee)); }
  return fetchUpstream<OrderResponse>(`${BASE}/order?${qs}`, { headers: headers(), retries: 0, timeoutMs: 12_000 });
}

export async function v2Execute(signedTransaction: string, requestId: string) {
  return fetchUpstream<{ status: string; signature?: string; code: number; error?: string; totalInputAmount?: string; outputAmountResult?: string }>(`${BASE}/execute`, {
    method: "POST", body: { signedTransaction, requestId }, headers: headers(), retries: 0, timeoutMs: 60_000,
  });
}

const toIx = (i: ApiIx) => new TransactionInstruction({
  programId: new PublicKey(i.programId),
  keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  data: Buffer.from(i.data, "base64"),
});

/**
 * Assemble an UNSIGNED v0 transaction from a /build response: lookup tables and
 * blockhash come from Jupiter, the compute-unit limit from a simulation.
 * Throws if the simulation fails, so users are never asked to sign a failing swap.
 */
export async function assembleBuild(b: BuildResponse, taker: string): Promise<{ transaction: string; lastValidBlockHeight: number; unitsConsumed: number | null }> {
  const alts = Object.entries(b.addressesByLookupTableAddress ?? {}).map(([key, addrs]) => new AddressLookupTableAccount({
    key: new PublicKey(key),
    state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: addrs.map((a) => new PublicKey(a)) },
  }));
  const blockhash = bs58.encode(Uint8Array.from(b.blockhashWithMetadata.blockhash));
  const core = [
    ...b.computeBudgetInstructions.map(toIx),
    ...b.setupInstructions.map(toIx),
    toIx(b.swapInstruction),
    ...(b.cleanupInstruction ? [toIx(b.cleanupInstruction)] : []),
    ...b.otherInstructions.map(toIx),
  ];
  const compile = (limit: number) => new VersionedTransaction(new TransactionMessage({
    payerKey: new PublicKey(taker), recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: limit }), ...core],
  }).compileToV0Message(alts));
  const probe = Buffer.from(compile(1_400_000).serialize()).toString("base64");
  const sim = await srpc<{ value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }>("simulateTransaction", [probe, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "processed" }]);
  if (sim.value.err) {
    const log = (sim.value.logs ?? []).filter((l) => /error|failed|insufficient/i.test(l)).slice(-2).join(" | ");
    throw new Error(`Swap simulation failed: ${JSON.stringify(sim.value.err)}${log ? ` — ${log}` : ""}`);
  }
  const units = sim.value.unitsConsumed ?? null;
  const limit = units ? Math.min(1_400_000, Math.ceil(units * 1.2) + 10_000) : 1_400_000;
  return { transaction: Buffer.from(compile(limit).serialize()).toString("base64"), lastValidBlockHeight: b.blockhashWithMetadata.lastValidBlockHeight, unitsConsumed: units };
}

/** True if the /build swap instruction actually routes the fee into `feeAccount`. */
export const buildIncludesFeeAccount = (b: BuildResponse, feeAccount: string) => b.swapInstruction.accounts.some((a) => a.pubkey === feeAccount);

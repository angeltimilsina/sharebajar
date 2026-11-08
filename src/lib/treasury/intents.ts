import "server-only";
import { q, newId } from "./db";
import { seal, verifySeal } from "./crypto";

/**
 * A swap intent describes the fee Bajar expects from a specific swap.
 * The server issues it as a sealed token alongside the quote/transaction;
 * the browser can only hand it back with a transaction hash. Expected-fee
 * figures therefore always come from the server, never from the client.
 */
export interface IntentClaims {
  provider: "jupiter" | "0x" | "lifi";
  route: string;           // jupiter: build | order; 0x: allowance-holder; lifi:<tool>
  chain: string;
  mode: string;
  treasuryId: string | null;
  feeToken: string | null;
  feeAccount: string | null;
  feeBps: number;
  providerShareBps: number;
  expectedFee: string | null; // raw units, net to treasury
  quoteOut: string;
  slippageBps: number;
  taker: string;
  isTest: boolean;
  requestId?: string;
  exp: number;
}

export function issueIntent(c: Omit<IntentClaims, "exp">, ttlMs = 10 * 60_000): string {
  const claims: IntentClaims = { ...c, exp: Date.now() + ttlMs };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${seal({ intent: body })}`;
}

export function readIntent(token: string): IntentClaims | null {
  const [body, mac] = String(token ?? "").split(".");
  if (!body || !mac || !verifySeal({ intent: body }, mac)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as IntentClaims;
    return c.exp > Date.now() - 60 * 60_000 ? c : null; // allow late reporting for 1h after expiry
  } catch {
    return null;
  }
}

export async function recordIntent(c: IntentClaims, txHash: string): Promise<{ id: string; duplicate: boolean }> {
  const existing = await q<{ id: string }>("select id from swap_intents where chain=$1 and tx_hash=$2", [c.chain, txHash]);
  if (existing[0]) return { id: existing[0].id, duplicate: true };
  const id = newId("int");
  await q(
    `insert into swap_intents (id, chain, provider, mode, tx_hash, request_id, taker, treasury_id, fee_token, fee_account, fee_bps, expected_fee, provider_share_bps, quote_out, slippage_bps, is_test)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, c.chain, c.provider, c.mode, txHash, c.requestId ?? null, c.taker, c.treasuryId, c.feeToken, c.feeAccount, c.feeBps, c.expectedFee, c.providerShareBps, c.quoteOut, c.slippageBps, c.isTest],
  );
  return { id, duplicate: false };
}

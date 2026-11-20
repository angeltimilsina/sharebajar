import "server-only";
import { q, newId } from "@/lib/treasury/db";
import { srpc } from "@/lib/treasury/solana";
import { PRO, USDC_SOLANA, planOf, proRecipient, walletsOf } from "./profile";

interface TokenBal { owner?: string; mint: string; uiTokenAmount: { amount: string } }
interface ParsedTx { blockTime: number | null; meta: { err: unknown; preTokenBalances?: TokenBal[]; postTokenBalances?: TokenBal[] } | null; transaction: { message: { accountKeys: ({ pubkey: string; signer: boolean } | string)[] } } }

/**
 * Activates Pro from a Solana USDC payment, trusting nothing from the
 * browser: the transaction must have succeeded recently, been paid by a
 * wallet linked to this profile, and increased the treasury's USDC by at
 * least the price. Each transaction can be used once.
 */
export async function activateFromPayment(profileId: string, signature: string): Promise<{ ok: true; until: string } | { ok: false; status: number; error: string }> {
  const recipient = await proRecipient();
  if (!recipient) return { ok: false, status: 503, error: "Pro checkout isn't open yet." };
  const used = await q("select 1 from subscriptions where signature = $1", [signature]);
  if (used.length) return { ok: false, status: 409, error: "This payment was already used." };
  const tx = await srpc<ParsedTx | null>("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
  if (!tx) return { ok: false, status: 404, error: "Payment not found yet — try again in a few seconds." };
  if (tx.meta?.err) return { ok: false, status: 400, error: "Payment failed on-chain." };
  if (!tx.blockTime || Date.now() - tx.blockTime * 1000 > 2 * 3600_000) return { ok: false, status: 400, error: "Payment is too old to activate Pro." };
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? { pubkey: k, signer: false } : k));
  const payer = keys[0].pubkey;
  const linked = (await walletsOf(profileId)).map((w) => w.address);
  if (!linked.includes(payer)) return { ok: false, status: 400, error: "Pay from a wallet linked to your profile." };
  const sum = (list: TokenBal[] | undefined) => (list ?? []).filter((b) => b.owner === recipient && b.mint === USDC_SOLANA).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), BigInt(0));
  const received = sum(tx.meta?.postTokenBalances) - sum(tx.meta?.preTokenBalances);
  const price = BigInt(Math.round(PRO.priceUsdc * 1e6));
  if (received < price) return { ok: false, status: 400, error: `Payment must send at least ${PRO.priceUsdc} USDC to Bajar's treasury.` };
  // Extend from the later of now and the current end date.
  const plan = await planOf(profileId);
  const start = plan.tier === "pro" && plan.until ? new Date(plan.until).getTime() : Date.now();
  const end = new Date(start + PRO.periodDays * 86_400_000);
  await q("insert into subscriptions (id, profile_id, plan, period_end, chain, signature, payer, amount_raw) values ($1,$2,'pro',$3,'solana',$4,$5,$6)", [newId("sub"), profileId, end.toISOString(), signature, payer, received.toString()]);
  return { ok: true, until: end.toISOString() };
}

import "server-only";
import { fetchUpstream } from "../server/http";

/**
 * 0x Swap API v2 (AllowanceHolder). Integrator fees via swapFeeRecipient,
 * swapFeeBps and swapFeeToken (must equal buyToken or sellToken).
 * Docs: https://docs.0x.org/evm/0x-swap-api/guides/monetize-your-app-using-swap
 */
const BASE = "https://api.0x.org/swap/allowance-holder";

export const zeroXConfigured = () => !!process.env.ZEROX_API_KEY;

export interface ZeroXFee { amount: string; token: string; type: string }
export interface ZeroXQuote {
  liquidityAvailable: boolean;
  buyAmount: string; minBuyAmount: string; sellAmount: string; buyToken: string; sellToken: string;
  allowanceTarget: string | null;
  fees: { integratorFee: ZeroXFee | null; integratorFees?: ZeroXFee[] | null; zeroExFee: ZeroXFee | null; gasFee: ZeroXFee | null };
  issues: { allowance: { actual: string; spender: string } | null; balance: { token: string; actual: string; expected: string } | null; simulationIncomplete: boolean; invalidSourcesPassed: string[] };
  route?: { fills: { source: string; proportionBps: string }[] };
  totalNetworkFee: string | null;
  transaction?: { to: string; data: string; gas: string | null; gasPrice: string; value: string };
  zid: string;
}

export interface ZeroXParams { chainId: number; sellToken: string; buyToken: string; sellAmount: string; taker?: string; slippageBps?: number; fee?: { recipient: string; bps: number; token: string } }

export async function zeroXQuote(p: ZeroXParams, firm: boolean): Promise<ZeroXQuote> {
  const key = process.env.ZEROX_API_KEY;
  if (!key) throw new Error("EVM swaps are not configured (ZEROX_API_KEY missing).");
  const qs = new URLSearchParams({ chainId: String(p.chainId), sellToken: p.sellToken, buyToken: p.buyToken, sellAmount: p.sellAmount });
  if (p.taker) qs.set("taker", p.taker);
  if (p.slippageBps) qs.set("slippageBps", String(p.slippageBps));
  if (p.fee) { qs.set("swapFeeRecipient", p.fee.recipient); qs.set("swapFeeBps", String(p.fee.bps)); qs.set("swapFeeToken", p.fee.token); }
  return fetchUpstream<ZeroXQuote>(`${BASE}/${firm ? "quote" : "price"}?${qs}`, { headers: { "0x-api-key": key, "0x-version": "v2" }, retries: 0, timeoutMs: 12_000 });
}

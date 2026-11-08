import "server-only";
import { fetchUpstream } from "../server/http";

/**
 * LI.FI cross-chain routing (EVM ↔ Solana ↔ native Bitcoin).
 * Integrator fee: `integrator` + `fee` (decimal). LI.FI refuses fees for
 * integrators that haven't configured a fee wallet in the LI.FI Partner Portal,
 * so ShareBajar only charges when LIFI_INTEGRATOR is set and the quote confirms it.
 * Docs: https://docs.li.fi/introduction/integrating-lifi/monetizing-integration
 */
const BASE = "https://li.quest/v1";
export const LIFI_CHAIN: Record<string, number> = {
  bitcoin: 20000000000001, solana: 1151111081099710, ethereum: 1, base: 8453, arbitrum: 42161, optimism: 10, polygon: 137, bsc: 56, avalanche: 43114,
};
export const LIFI_NATIVE: Record<string, string> = { bitcoin: "bitcoin", solana: "11111111111111111111111111111111" };
export const lifiNative = (network: string) => LIFI_NATIVE[network] ?? "0x0000000000000000000000000000000000000000";
export const CROSS_CHAIN_FEE_BPS = Number(process.env.CROSS_CHAIN_FEE_BPS ?? 50);
const headers = (): Record<string, string> => (process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : {});

export interface LifiFeeCost { name: string; amount: string; amountUSD?: string; percentage?: string; included: boolean; token: { address: string; symbol: string; decimals: number; chainId: number }; feeSplit?: { integratorFee?: string; lifiFee?: string } }
export interface LifiQuote {
  id: string; tool: string; toolDetails?: { name: string };
  action: { fromChainId: number; toChainId: number; fromToken: { address: string; symbol: string; decimals: number }; toToken: { address: string; symbol: string; decimals: number }; fromAmount: string; slippage: number; fromAddress: string; toAddress: string };
  estimate: { toAmount: string; toAmountMin: string; executionDuration: number; approvalAddress?: string; feeCosts?: LifiFeeCost[]; gasCosts?: { type: string; amount: string; amountUSD?: string; token: { symbol: string; decimals: number } }[]; fromAmountUSD?: string; toAmountUSD?: string };
  transactionRequest?: { to?: string; data?: string; value?: string; gasLimit?: string; gasPrice?: string; chainId?: number; from?: string };
}

export async function lifiQuote(p: { fromNetwork: string; toNetwork: string; fromToken: string; toToken: string; fromAmount: string; fromAddress: string; toAddress: string; slippage: number; feeBps?: number }): Promise<{ quote: LifiQuote; feeRequested: number }> {
  const integrator = process.env.LIFI_INTEGRATOR;
  const fee = integrator ? (p.feeBps ?? CROSS_CHAIN_FEE_BPS) / 10_000 : 0;
  const qs = new URLSearchParams({
    fromChain: String(LIFI_CHAIN[p.fromNetwork]), toChain: String(LIFI_CHAIN[p.toNetwork]), fromToken: p.fromToken, toToken: p.toToken,
    fromAmount: p.fromAmount, fromAddress: p.fromAddress, toAddress: p.toAddress, slippage: String(p.slippage),
  });
  if (integrator) { qs.set("integrator", integrator); if (fee > 0) qs.set("fee", String(fee)); }
  const quote = await fetchUpstream<LifiQuote & { message?: string }>(`${BASE}/quote?${qs}`, { headers: headers(), retries: 0, timeoutMs: 25_000 });
  if ((quote as { message?: string }).message) throw new Error((quote as { message?: string }).message);
  return { quote, feeRequested: fee };
}

/** Integrator fee actually present in the quote (in source-token base units). */
export function integratorFeeOf(q: LifiQuote): { amount: string; symbol: string; decimals: number; token: string } | null {
  for (const f of q.estimate.feeCosts ?? []) {
    const amt = f.feeSplit?.integratorFee;
    if (amt && BigInt(amt) > BigInt(0)) return { amount: amt, symbol: f.token.symbol, decimals: f.token.decimals, token: f.token.address };
    if (/integrator/i.test(f.name) && BigInt(f.amount || "0") > BigInt(0)) return { amount: f.amount, symbol: f.token.symbol, decimals: f.token.decimals, token: f.token.address };
  }
  return null;
}

export async function lifiStatus(txHash: string, fromNetwork: string, toNetwork: string) {
  const qs = new URLSearchParams({ txHash, fromChain: String(LIFI_CHAIN[fromNetwork]), toChain: String(LIFI_CHAIN[toNetwork]) });
  return fetchUpstream<{ status: string; substatus?: string; substatusMessage?: string; receiving?: { txHash?: string; amount?: string; txLink?: string }; sending?: { txLink?: string } }>(`${BASE}/status?${qs}`, { headers: headers(), retries: 0 });
}

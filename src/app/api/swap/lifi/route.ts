import { NextResponse } from "next/server";
import { CROSS_CHAIN_FEE_BPS, integratorFeeOf, LIFI_CHAIN, lifiQuote } from "@/lib/trading/lifi";
import { issueIntent } from "@/lib/treasury/intents";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { listTreasuries } from "@/lib/treasury/store";

/**
 * Cross-chain / native-BTC quote via LI.FI. Returns an executable transaction
 * (EVM tx, Solana tx, or Bitcoin PSBT) that the user's wallet signs locally.
 */
export async function GET(req: Request) {
  const rl = rateLimit(`lifi:${clientIp(req)}`, 20, 30);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const u = new URL(req.url);
  const g = (k: string) => (u.searchParams.get(k) ?? "").trim();
  const fromNetwork = g("fromNetwork"), toNetwork = g("toNetwork");
  if (!LIFI_CHAIN[fromNetwork] || !LIFI_CHAIN[toNetwork]) return NextResponse.json({ error: "Unsupported network" }, { status: 400 });
  const fromAmount = g("fromAmount");
  if (!/^\d{1,40}$/.test(fromAmount) || fromAmount === "0") return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  const slippage = Math.min(0.05, Math.max(0.001, Number(g("slippage") || "0.005")));
  try {
    // LI.FI pays the fee to the wallet configured in its Partner Portal — that must be the
    // registered, active treasury for the SOURCE network so the indexer can verify it.
    // No such treasury ⇒ no fee is requested at all.
    const treasury = (await listTreasuries().catch(() => [])).find((t) => t.chain === fromNetwork && t.integrityOk && t.ownership && t.status === "active" && t.environment === "mainnet" && t.feeConfig);
    const bps = treasury?.feeConfig?.crossChainFeeBps ?? treasury?.feeConfig?.feeBps ?? CROSS_CHAIN_FEE_BPS;
    const { quote, feeRequested } = await lifiQuote({ fromNetwork, toNetwork, fromToken: g("fromToken"), toToken: g("toToken"), fromAmount, fromAddress: g("fromAddress"), toAddress: g("toAddress"), slippage, feeBps: treasury ? bps : 0 });
    const integ = integratorFeeOf(quote);
    const fee = feeRequested > 0 && integ
      ? { applied: true as const, bps, provider: "LI.FI integrator fee", token: integ.token, symbol: integ.symbol, decimals: integ.decimals, estimatedAmount: integ.amount, note: `Bajar cross-chain fee ${(bps / 100).toFixed(2)}% of the amount sent (replaces the 0.30% swap fee). Paid by LI.FI to the Bajar treasury on ${fromNetwork}.` }
      : { applied: false as const, reason: feeRequested > 0 ? "LI.FI did not apply the Bajar fee to this route, so none is charged." : !process.env.LIFI_INTEGRATOR ? "Cross-chain platform fee is not configured on this deployment." : "No active Bajar treasury on the source network, so no cross-chain fee is charged." };
    const feeAccount = !fee.applied || !treasury ? null
      : fromNetwork === "solana" && fee.token !== "11111111111111111111111111111111" ? (await import("@/lib/treasury/solana")).ata(treasury.address, fee.token, (await import("@/lib/treasury/solana")).TOKEN_PROGRAM)
      : treasury.address;
    const intentToken = quote.transactionRequest ? issueIntent({
      provider: "lifi", route: `lifi:${quote.tool}`, chain: fromNetwork, mode: fee.applied ? "cross_chain" : "none", treasuryId: treasury?.id ?? null,
      feeToken: fee.applied ? fee.token : null, feeAccount, feeBps: fee.applied ? fee.bps : 0, providerShareBps: 0, expectedFee: fee.applied ? fee.estimatedAmount : null,
      quoteOut: quote.estimate.toAmount, slippageBps: Math.round(slippage * 10_000), taker: g("fromAddress"), isTest: false,
    }) : null;
    return NextResponse.json({ quote, fee, intentToken, fetchedAt: Date.now() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: /No available quotes|NOT_FOUND|404/i.test(m) ? "No route available for this pair and amount." : m.slice(0, 300) }, { status: 502 });
  }
}

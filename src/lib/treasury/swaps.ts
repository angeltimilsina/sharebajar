import "server-only";
import { assembleBuild, buildIncludesFeeAccount, QUOTE_TAKER, v2Build, v2Order, type BuildResponse, type OrderResponse } from "../trading/jupiterV2";
import { zeroXQuote, type ZeroXQuote } from "../trading/zerox";
import { feeCandidates, isAdminAddress } from "./service";
import { feeFromGross, platformFeeFromNetOut, selectEvmFee, selectSolanaFee, type FeeDecision } from "./fees";
import { issueIntent } from "./intents";
import { alert } from "./audit";
import { ata, mintInfo, TOKEN_PROGRAM } from "./solana";
import { knownToken, sameToken, ZEROX_CHAINS } from "./tokens";
import type { Treasury } from "./store";

/** What the user is shown before authorising: always explicit, never silent. */
export type FeeDisclosure =
  | { applied: true; bps: number; mode: string; provider: string; token: string | null; symbol: string | null; decimals: number | null; estimatedAmount: string | null; recipient: string; providerShareBps: number; isTest: boolean; note: string }
  | { applied: false; reason: string };

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/* ------------------------------- Solana -------------------------------- */

export interface SolanaQuote {
  provider: "jupiter";
  route: "build" | "order";
  inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct: number; slippageBps: number;
  routeLabels: string[];
  fee: FeeDisclosure;
  jupiterFee: { bps: number; mint: string | null } | null;
  intentToken: string | null;
}

interface SolanaInternal { quote: SolanaQuote; decision: FeeDecision; build?: BuildResponse; order?: OrderResponse; feeAccount: string | null; feeToken: string | null; expectedNet: string | null }

async function solanaCore(p: { inputMint: string; outputMint: string; amount: string; slippageBps: number; taker?: string }): Promise<SolanaInternal> {
  const takerIsAdmin = p.taker ? await isAdminAddress(p.taker) : false;
  const decision = selectSolanaFee(await feeCandidates("solana"), p.outputMint, takerIsAdmin);

  if (decision.applied && decision.mode === "referral") {
    const order = await v2Order({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount, taker: p.taker, slippageBps: p.slippageBps, referralAccount: decision.recipient, referralFee: decision.bps });
    if (order.error || order.errorMessage) throw new Error(order.errorMessage ?? order.error);
    const applied = order.referralAccount === decision.recipient;
    let fee: FeeDisclosure, expectedNet: string | null = null, feeAccount: string | null = null;
    if (applied) {
      const gross = sameToken(order.feeMint, p.inputMint) ? feeFromGross(BigInt(order.inAmount), decision.bps)
        : sameToken(order.feeMint, p.outputMint) ? platformFeeFromNetOut(BigInt(order.outAmount), decision.bps) : null;
      expectedNet = gross === null ? null : ((gross * BigInt(10_000 - decision.providerShareBps)) / BigInt(10_000)).toString();
      const mi = await mintInfo(order.feeMint).catch(() => null);
      feeAccount = ata(decision.recipient, order.feeMint, mi?.tokenProgram ?? TOKEN_PROGRAM);
      const k = knownToken("solana", order.feeMint);
      fee = { applied: true, bps: decision.bps, mode: "referral", provider: "Jupiter Swap V2 /order", token: order.feeMint, symbol: k?.symbol ?? null, decimals: mi?.decimals ?? k?.decimals ?? null, estimatedAmount: gross?.toString() ?? null, recipient: feeAccount, providerShareBps: decision.providerShareBps, isTest: decision.isTest, note: `ShareBajar fee ${(decision.bps / 100).toFixed(2)}% (Jupiter keeps ${decision.providerShareBps / 100}% of it; no separate Jupiter fee).` };
    } else {
      fee = { applied: false, reason: `ShareBajar referral fee could not be applied to this route (fee mint ${short(order.feeMint)} has no initialized referral token account). Jupiter's standard fee applies instead.` };
      void alert("warning", "fee_not_applied", `Jupiter /order did not apply the referral fee (feeMint ${order.feeMint}). Initialize a referral token account for this mint.`);
    }
    const quote: SolanaQuote = {
      provider: "jupiter", route: "order", inAmount: order.inAmount, outAmount: order.outAmount, otherAmountThreshold: order.otherAmountThreshold ?? order.outAmount,
      priceImpactPct: Number(order.priceImpactPct ?? order.priceImpact ?? 0), slippageBps: order.slippageBps ?? p.slippageBps,
      routeLabels: [...new Set((order.routePlan ?? []).map((r) => r.swapInfo.label))].length ? [...new Set((order.routePlan ?? []).map((r) => r.swapInfo.label))] : [order.router],
      fee, jupiterFee: applied ? null : { bps: order.platformFee?.feeBps ?? order.feeBps, mint: order.feeMint }, intentToken: null,
    };
    return { quote, decision, order, feeAccount, feeToken: applied ? order.feeMint : null, expectedNet };
  }

  const feeOn = decision.applied && decision.mode === "platform";
  const build = await v2Build({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount, slippageBps: p.slippageBps, taker: p.taker ?? QUOTE_TAKER, ...(feeOn ? { platformFeeBps: decision.bps, feeAccount: decision.recipient } : {}) });
  let fee: FeeDisclosure;
  let expectedNet: string | null = null;
  if (feeOn && decision.applied) {
    if (!buildIncludesFeeAccount(build, decision.recipient)) {
      void alert("critical", "fee_not_applied", `Jupiter /build response did not include fee account ${decision.recipient}; fee disabled for this swap.`);
      fee = { applied: false, reason: "Platform fee could not be attached to this route, so none is charged." };
    } else {
      expectedNet = platformFeeFromNetOut(BigInt(build.outAmount), decision.bps).toString();
      fee = { applied: true, bps: decision.bps, mode: "platform", provider: "Jupiter Swap V2 /build", token: decision.token, symbol: decision.symbol, decimals: decision.decimals, estimatedAmount: expectedNet, recipient: decision.recipient, providerShareBps: 0, isTest: decision.isTest, note: `ShareBajar platform fee ${(decision.bps / 100).toFixed(2)}%, taken from the ${decision.symbol} you receive. Jupiter charges no swap fee on this route.` };
    }
  } else fee = { applied: false, reason: decision.applied ? "No platform fee on this swap." : decision.reason };
  const quote: SolanaQuote = {
    provider: "jupiter", route: "build", inAmount: build.inAmount, outAmount: build.outAmount, otherAmountThreshold: build.otherAmountThreshold,
    priceImpactPct: Number(build.priceImpactPct ?? 0), slippageBps: build.slippageBps,
    routeLabels: [...new Set(build.routePlan.map((r) => r.swapInfo.label))], fee, jupiterFee: null, intentToken: null,
  };
  return { quote, decision, build, feeAccount: fee.applied ? decision.applied ? decision.recipient : null : null, feeToken: fee.applied && decision.applied ? decision.token : null, expectedNet };
}

export async function solanaQuote(p: { inputMint: string; outputMint: string; amount: string; slippageBps: number; taker?: string }): Promise<SolanaQuote> {
  return (await solanaCore(p)).quote;
}

/** Fresh quote + unsigned transaction for the user's wallet, with a sealed fee intent. */
export async function solanaPrepare(p: { inputMint: string; outputMint: string; amount: string; slippageBps: number; taker: string }) {
  const r = await solanaCore(p);
  const intent = issueIntent({
    provider: "jupiter", route: r.quote.route, chain: "solana", mode: r.quote.fee.applied ? r.quote.fee.mode : "none",
    treasuryId: r.quote.fee.applied && r.decision.applied ? r.decision.treasuryId : null, feeToken: r.feeToken, feeAccount: r.feeAccount,
    feeBps: r.quote.fee.applied ? r.quote.fee.bps : 0, providerShareBps: r.quote.fee.applied ? r.quote.fee.providerShareBps : 0, expectedFee: r.expectedNet,
    quoteOut: r.quote.outAmount, slippageBps: r.quote.slippageBps, taker: p.taker, isTest: r.quote.fee.applied ? r.quote.fee.isTest : false, requestId: r.order?.requestId,
  });
  if (r.order) {
    if (!r.order.transaction) throw new Error("Jupiter returned no transaction for this order.");
    return { route: "order" as const, transaction: r.order.transaction, requestId: r.order.requestId, lastValidBlockHeight: null, quote: { ...r.quote, intentToken: intent } };
  }
  const tx = await assembleBuild(r.build!, p.taker);
  return { route: "build" as const, transaction: tx.transaction, requestId: null, lastValidBlockHeight: tx.lastValidBlockHeight, unitsConsumed: tx.unitsConsumed, quote: { ...r.quote, intentToken: intent } };
}

/* -------------------------------- EVM ---------------------------------- */

export async function evmQuote(p: { chain: string; sellToken: string; buyToken: string; sellAmount: string; taker?: string; slippageBps?: number }) {
  const chainId = ZEROX_CHAINS[p.chain];
  if (!chainId) throw new Error(`0x swaps are not supported on ${p.chain}`);
  const takerIsAdmin = p.taker ? await isAdminAddress(p.taker) : false;
  const decision = selectEvmFee(await feeCandidates(p.chain), p.sellToken, p.buyToken, takerIsAdmin);
  const fee0 = decision.applied ? { recipient: decision.recipient, bps: decision.bps, token: decision.token! } : undefined;
  const q: ZeroXQuote = await zeroXQuote({ chainId, sellToken: p.sellToken, buyToken: p.buyToken, sellAmount: p.sellAmount, taker: p.taker, slippageBps: p.slippageBps, fee: fee0 }, !!p.taker);
  if (!q.liquidityAvailable) return { liquidityAvailable: false as const };
  let fee: FeeDisclosure;
  if (decision.applied) {
    const integ = q.fees.integratorFee;
    if (integ && BigInt(integ.amount) > BigInt(0) && sameToken(integ.token, decision.token!)) {
      fee = { applied: true, bps: decision.bps, mode: "integrator", provider: "0x Swap API", token: decision.token, symbol: decision.symbol, decimals: decision.decimals, estimatedAmount: integ.amount, recipient: decision.recipient, providerShareBps: 0, isTest: decision.isTest, note: `ShareBajar platform fee ${(decision.bps / 100).toFixed(2)}% in ${decision.symbol}.` };
    } else {
      void alert("warning", "fee_not_applied", `0x quote on ${p.chain} did not return the requested integrator fee.`);
      fee = { applied: false, reason: "0x did not apply the platform fee to this quote, so none is charged." };
    }
  } else fee = { applied: false, reason: decision.reason };
  const intentToken = p.taker && q.transaction ? issueIntent({
    provider: "0x", route: "allowance-holder", chain: p.chain, mode: fee.applied ? "integrator" : "none", treasuryId: fee.applied && decision.applied ? decision.treasuryId : null,
    feeToken: fee.applied ? fee.token : null, feeAccount: fee.applied ? fee.recipient : null, feeBps: fee.applied ? fee.bps : 0, providerShareBps: 0,
    expectedFee: fee.applied ? fee.estimatedAmount : null, quoteOut: q.buyAmount, slippageBps: p.slippageBps ?? 100, taker: p.taker, isTest: fee.applied ? fee.isTest : false,
  }) : null;
  return {
    liquidityAvailable: true as const, buyAmount: q.buyAmount, minBuyAmount: q.minBuyAmount, sellAmount: q.sellAmount, allowanceTarget: q.allowanceTarget,
    zeroExFee: q.fees.zeroExFee, gasFee: q.fees.gasFee, issues: q.issues, totalNetworkFee: q.totalNetworkFee, transaction: q.transaction ?? null,
    sources: [...new Set((q.route?.fills ?? []).map((f) => f.source))], fee, intentToken, chainId,
  };
}

/* ------------------------- Validation live check ------------------------ */

export async function liveQuoteCheck(t: Treasury): Promise<{ ok: boolean; detail: string }> {
  const cfg = t.feeConfig!;
  const tok = cfg.tokens[0];
  if (t.chainType === "solana") {
    const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const SOL = "So11111111111111111111111111111111111111112";
    const input = tok.token === SOL ? USDC : SOL;
    const amount = input === SOL ? "50000000" : "5000000";
    if (cfg.mode === "referral") {
      const o = await v2Order({ inputMint: input, outputMint: tok.token, amount, referralAccount: t.address, referralFee: cfg.feeBps });
      const ok = o.referralAccount === t.address;
      return { ok, detail: ok ? `Jupiter /order echoed our referral account; total feeBps ${o.feeBps}, fee mint ${short(o.feeMint)}.` : `Referral fee not applied (feeMint ${short(o.feeMint)} likely lacks a referral token account).` };
    }
    const b = await v2Build({ inputMint: input, outputMint: tok.token, amount, slippageBps: 50, taker: t.kind === "wallet" ? t.address : QUOTE_TAKER, platformFeeBps: cfg.feeBps, feeAccount: tok.tokenAccount! });
    const ok = buildIncludesFeeAccount(b, tok.tokenAccount!);
    return { ok, detail: ok ? `Jupiter /build swap instruction routes ${cfg.feeBps} bps into ${short(tok.tokenAccount!)} (est. ${platformFeeFromNetOut(BigInt(b.outAmount), cfg.feeBps)} base units of ${tok.symbol}).` : "Fee account missing from the swap instruction." };
  }
  const chainId = ZEROX_CHAINS[t.chain];
  const other = (await import("./tokens")).KNOWN_TOKENS[t.chain]?.find((x) => !sameToken(x.token, tok.token));
  if (!other) return { ok: false, detail: "No counter-token available for a test quote." };
  const sellAmount = (BigInt(10) ** BigInt(other.decimals) * BigInt(other.stable ? 10 : 1) / BigInt(other.stable ? 1 : 100)).toString();
  const q = await zeroXQuote({ chainId, sellToken: other.token, buyToken: tok.token, sellAmount, fee: { recipient: t.address, bps: cfg.feeBps, token: tok.token } }, false);
  const f = q.fees?.integratorFee;
  const ok = !!f && BigInt(f.amount) > BigInt(0) && sameToken(f.token, tok.token);
  return { ok, detail: ok ? `0x quote returns integratorFee ${f!.amount} (${tok.symbol} base units) to ${short(t.address)}; 0x fee ${q.fees.zeroExFee?.amount ?? "0"}.` : "0x did not return the integrator fee." };
}

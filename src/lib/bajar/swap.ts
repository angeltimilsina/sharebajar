"use client";
import { encodeFunctionData, erc20Abi } from "viem";
import { bajar } from "./session";
import { evmSendTransaction } from "./providers";
import { walletRpc } from "./rpc";
import { signAndBroadcastPsbt, signAndSendSolanaB64, signSolanaB64, recordLocal } from "./send";
import { UserRejected } from "./approvals";

/**
 * Universal swap engine for BAJAR Wallet.
 *  - Solana same-chain → Jupiter Swap V2 (ShareBajar 0.30% where supported)
 *  - EVM same-chain     → 0x AllowanceHolder (ShareBajar 0.30% where supported)
 *  - Cross-chain & native BTC → LI.FI (ShareBajar 0.50% replaces the swap fee, only if configured)
 * Every transaction goes through BAJAR's explicit approval prompt before signing.
 */

export interface SwapAsset { key: string; network: string; token: string; symbol: string; decimals: number; label: string; wrappedBtc?: boolean; native?: boolean }

const NATIVE_EVM = "0x0000000000000000000000000000000000000000";
const ZEROX_NATIVE = "0xEeeeeEeeeEeEeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const WSOL = "So11111111111111111111111111111111111111112";

export const SWAP_ASSETS: SwapAsset[] = [
  { key: "btc", network: "bitcoin", token: "bitcoin", symbol: "BTC", decimals: 8, label: "Bitcoin (native)", native: true },
  { key: "sol", network: "solana", token: WSOL, symbol: "SOL", decimals: 9, label: "SOL · Solana", native: true },
  { key: "usdc-sol", network: "solana", token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, label: "USDC · Solana" },
  { key: "usdt-sol", network: "solana", token: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6, label: "USDT · Solana" },
  { key: "eth", network: "ethereum", token: NATIVE_EVM, symbol: "ETH", decimals: 18, label: "ETH · Ethereum", native: true },
  { key: "usdc-eth", network: "ethereum", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6, label: "USDC · Ethereum" },
  { key: "usdt-eth", network: "ethereum", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6, label: "USDT · Ethereum" },
  { key: "wbtc-eth", network: "ethereum", token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", decimals: 8, label: "WBTC · Ethereum (wrapped BTC, not native)", wrappedBtc: true },
  { key: "eth-base", network: "base", token: NATIVE_EVM, symbol: "ETH", decimals: 18, label: "ETH · Base", native: true },
  { key: "usdc-base", network: "base", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, label: "USDC · Base" },
  { key: "cbbtc-base", network: "base", token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", symbol: "cbBTC", decimals: 8, label: "cbBTC · Base (wrapped BTC, not native)", wrappedBtc: true },
  { key: "eth-arb", network: "arbitrum", token: NATIVE_EVM, symbol: "ETH", decimals: 18, label: "ETH · Arbitrum", native: true },
  { key: "usdc-arb", network: "arbitrum", token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", decimals: 6, label: "USDC · Arbitrum" },
  { key: "usdt-arb", network: "arbitrum", token: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USDT", decimals: 6, label: "USDT · Arbitrum" },
];

export type Provider = "jupiter" | "0x" | "lifi";
export interface FeeInfo { applied: boolean; bps?: number; symbol?: string | null; decimals?: number | null; estimatedAmount?: string | null; note?: string; reason?: string }
export interface SwapQuote {
  provider: Provider; providerLabel: string; from: SwapAsset; to: SwapAsset; amountIn: string; amountOut: string; minOut: string | null;
  fee: FeeInfo; durationSec: number | null; route: string; intentToken: string | null; crossChain: boolean;
  raw: unknown; fetchedAt: number; slippageBps: number;
}

const addressFor = (network: string) => {
  const a = bajar.accounts()!;
  return network === "bitcoin" ? a.bitcoin.address : network === "solana" ? a.solana.address : a.evm.address;
};
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.error) throw new Error(b.error ?? `HTTP ${r.status}`);
  return b as T;
}

export function providerFor(from: SwapAsset, to: SwapAsset): Provider {
  if (from.network === to.network && from.network === "solana") return "jupiter";
  if (from.network === to.network && from.network !== "bitcoin") return "0x";
  return "lifi";
}

export async function quoteSwap(from: SwapAsset, to: SwapAsset, amountIn: bigint, slippageBps: number): Promise<SwapQuote> {
  if (from.key === to.key) throw new Error("Choose two different assets.");
  const provider = providerFor(from, to);
  const base = { from, to, amountIn: amountIn.toString(), fetchedAt: Date.now(), slippageBps };
  if (provider === "jupiter") {
    const b = await j<{ data: { outAmount: string; otherAmountThreshold?: string; routeLabels?: string[]; fee: FeeInfo; intentToken: string | null } }>(`/api/swap/quote?inputMint=${from.token}&outputMint=${to.token}&amount=${amountIn}&slippageBps=${slippageBps}&taker=${addressFor("solana")}`);
    return { ...base, provider, providerLabel: "Jupiter Swap V2", amountOut: b.data.outAmount, minOut: b.data.otherAmountThreshold ?? null, fee: b.data.fee, durationSec: 1, route: (b.data.routeLabels ?? []).join(" → ") || "Jupiter", intentToken: b.data.intentToken, crossChain: false, raw: b.data };
  }
  if (provider === "0x") {
    const tok = (a: SwapAsset) => (a.token === NATIVE_EVM ? ZEROX_NATIVE : a.token);
    const b = await j<{ data: { liquidityAvailable: boolean; buyAmount: string; minBuyAmount?: string; sources: string[]; fee: FeeInfo; intentToken: string | null; transaction: unknown } }>(`/api/swap/evm?chain=${from.network}&sellToken=${tok(from)}&buyToken=${tok(to)}&sellAmount=${amountIn}&taker=${addressFor(from.network)}&slippageBps=${slippageBps}`);
    if (!b.data.liquidityAvailable) throw new Error("No liquidity for this pair on 0x.");
    if (!b.data.transaction) throw new Error("0x returned no executable route for this pair (check balance).");
    return { ...base, provider, providerLabel: "0x Swap API", amountOut: b.data.buyAmount, minOut: b.data.minBuyAmount ?? null, fee: b.data.fee, durationSec: 15, route: b.data.sources.join(" + ") || "0x", intentToken: b.data.intentToken, crossChain: false, raw: b.data };
  }
  const qs = new URLSearchParams({ fromNetwork: from.network, toNetwork: to.network, fromToken: from.token === WSOL && from.network === "solana" ? "11111111111111111111111111111111" : from.token, toToken: to.token === WSOL && to.network === "solana" ? "11111111111111111111111111111111" : to.token, fromAmount: amountIn.toString(), fromAddress: addressFor(from.network), toAddress: addressFor(to.network), slippage: String(slippageBps / 10_000) });
  const b = await j<{ quote: { tool: string; toolDetails?: { name: string }; estimate: { toAmount: string; toAmountMin: string; executionDuration: number }; transactionRequest?: unknown }; fee: FeeInfo; intentToken: string | null }>(`/api/swap/lifi?${qs}`);
  if (!b.quote.transactionRequest) throw new Error("LI.FI returned a route without an executable transaction.");
  return { ...base, provider, providerLabel: `LI.FI · ${b.quote.toolDetails?.name ?? b.quote.tool}`, amountOut: b.quote.estimate.toAmount, minOut: b.quote.estimate.toAmountMin, fee: b.fee, durationSec: b.quote.estimate.executionDuration, route: b.quote.toolDetails?.name ?? b.quote.tool, intentToken: b.intentToken, crossChain: from.network !== to.network, raw: b.quote };
}

const reportIntent = (intentToken: string | null, txHash: string) => {
  if (intentToken) fetch("/api/treasury/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intentToken, txHash }) }).catch(() => {});
};

async function ensureAllowance(network: string, token: string, spender: string, amount: bigint, symbol: string) {
  const owner = addressFor(network);
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner as `0x${string}`, spender as `0x${string}`] });
  const res = await walletRpc<string>(network, "eth_call", [{ to: token, data }, "latest"]);
  if (BigInt(res === "0x" ? 0 : res) >= amount) return;
  const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender as `0x${string}`, amount] });
  const h = await evmSendTransaction(network, { to: token, data: approve }, `Allow ${symbol} spending (exact amount) by ${spender.slice(0, 8)}…`);
  for (let i = 0; i < 60; i++) {
    const rc = await walletRpc<{ status: string } | null>(network, "eth_getTransactionReceipt", [h]).catch(() => null);
    if (rc) { if (rc.status !== "0x1") throw new Error("Approval transaction failed."); return; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Approval still pending — try again once it confirms.");
}

/** Executes a quote. Returns the source-chain transaction hash. */
export async function executeSwap(q: SwapQuote): Promise<string> {
  if (Date.now() - q.fetchedAt > 60_000) throw new Error("Quote expired — refresh it before swapping.");
  const summary = `Swap ${q.from.symbol} → ${q.to.symbol}${q.crossChain ? ` (${q.from.network} → ${q.to.network})` : ""}`;
  if (q.provider === "jupiter") {
    const b = await j<{ route: "build" | "order"; transaction: string; requestId: string | null; quote: { intentToken: string | null } }>("/api/swap/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputMint: q.from.token, outputMint: q.to.token, amount: q.amountIn, slippageBps: q.slippageBps, userPublicKey: addressFor("solana") }) });
    let sig: string;
    if (b.route === "order") {
      const signed = await signSolanaB64(b.transaction);
      const r = await j<{ signature: string }>("/api/swap/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedTransaction: signed, requestId: b.requestId, intentToken: b.quote.intentToken }) });
      sig = r.signature;
    } else {
      sig = await signAndSendSolanaB64(b.transaction);
      reportIntent(b.quote.intentToken, sig);
    }
    recordLocal("solana", sig, summary);
    return sig;
  }
  if (q.provider === "0x") {
    const d = q.raw as { sellAmount: string; issues?: { allowance?: { spender: string } | null }; transaction: { to: string; data: string; value: string; gas: string | null } };
    if (d.issues?.allowance) await ensureAllowance(q.from.network, q.from.token, d.issues.allowance.spender, BigInt(d.sellAmount), q.from.symbol);
    const t = d.transaction;
    const h = await evmSendTransaction(q.from.network, { to: t.to, data: t.data, value: `0x${BigInt(t.value || 0).toString(16)}`, ...(t.gas ? { gas: `0x${BigInt(t.gas).toString(16)}` } : {}) }, summary);
    reportIntent(q.intentToken, h);
    recordLocal(q.from.network, h, summary);
    return h;
  }
  // LI.FI
  const quote = q.raw as { estimate: { approvalAddress?: string }; transactionRequest: { to?: string; data?: string; value?: string; gasLimit?: string } };
  const tr = quote.transactionRequest;
  let hash: string;
  if (q.from.network === "bitcoin") {
    const data = tr.data ?? "";
    const hex = /^[0-9a-f]+$/i.test(data) ? data : Array.from(atob(data), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    hash = await signAndBroadcastPsbt(hex, summary, [["Route", q.providerLabel], ["Receive (est.)", `${Number(q.amountOut) / 10 ** q.to.decimals} ${q.to.symbol}${q.to.wrappedBtc ? " (wrapped BTC)" : ""}`], ["Destination", addressFor(q.to.network)]]);
  } else if (q.from.network === "solana") {
    hash = await signAndSendSolanaB64(tr.data!);
    recordLocal("solana", hash, summary);
  } else {
    if (q.from.token !== NATIVE_EVM && quote.estimate.approvalAddress) await ensureAllowance(q.from.network, q.from.token, quote.estimate.approvalAddress, BigInt(q.amountIn), q.from.symbol);
    hash = await evmSendTransaction(q.from.network, { to: tr.to!, data: tr.data, value: tr.value, ...(tr.gasLimit ? { gas: tr.gasLimit } : {}) }, summary);
    recordLocal(q.from.network, hash, summary);
  }
  reportIntent(q.intentToken, hash);
  return hash;
}

export async function crossChainStatus(txHash: string, fromNetwork: string, toNetwork: string) {
  return j<{ status: string; substatus?: string; substatusMessage?: string; receiving?: { txHash?: string; txLink?: string } }>(`/api/swap/lifi/status?txHash=${txHash}&fromNetwork=${fromNetwork}&toNetwork=${toNetwork}`);
}

export { UserRejected };

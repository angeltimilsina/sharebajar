"use client";
import { encodeDeployData, encodeFunctionData, formatEther, parseUnits } from "viem";
import type { Eip1193 } from "@/lib/wallet/evm";
import { BAJAR_TOKEN_ABI, BAJAR_TOKEN_BYTECODE } from "./erc20Artifact";

/**
 * EVM token launch: deploys contracts/BajarToken.sol (fixed supply, 18
 * decimals, no owner or admin functions) from the creator's own wallet.
 * The whole supply goes to the creator. Bajar holds no key or role.
 */
export const EVM_LAUNCH_CHAINS = [
  { id: "ethereum", name: "Ethereum", chainId: 1, native: "ETH", explorer: "https://etherscan.io" },
  { id: "base", name: "Base", chainId: 8453, native: "ETH", explorer: "https://basescan.org" },
  { id: "bsc", name: "BNB Chain", chainId: 56, native: "BNB", explorer: "https://bscscan.com" },
] as const;
export type EvmLaunchChain = (typeof EVM_LAUNCH_CHAINS)[number];

const hex = (n: bigint) => `0x${n.toString(16)}`;

export function validateEvmLaunch(p: { name: string; symbol: string; supply: bigint }): string | null {
  if (!p.name.trim() || new TextEncoder().encode(p.name).length > 64) return "Name must be 1–64 bytes.";
  if (!/^[A-Z0-9$._-]{1,16}$/.test(p.symbol)) return "Symbol: 1–16 letters or digits.";
  if (p.supply <= BigInt(0)) return "Supply must be greater than zero.";
  if (p.supply > BigInt("1000000000000000000")) return "Supply is too large.";
  return null;
}

export function deployData(name: string, symbol: string, supplyWhole: bigint, recipient: `0x${string}`) {
  return encodeDeployData({ abi: BAJAR_TOKEN_ABI, bytecode: BAJAR_TOKEN_BYTECODE, args: [name.trim(), symbol, parseUnits(supplyWhole.toString(), 18), recipient] });
}

/** Parameters for wallet_addEthereumChain (EIP-3085) when the wallet doesn't know the network yet. */
const ADD_CHAIN: Record<number, { chainName: string; nativeCurrency: { name: string; symbol: string; decimals: 18 }; rpcUrls: string[]; blockExplorerUrls: string[] }> = {
  1: { chainName: "Ethereum", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://ethereum-rpc.publicnode.com"], blockExplorerUrls: ["https://etherscan.io"] },
  8453: { chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"], blockExplorerUrls: ["https://basescan.org"] },
  56: { chainName: "BNB Smart Chain", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"], blockExplorerUrls: ["https://bscscan.com"] },
};

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** EIP-1193 error codes, including ones wallets nest (MetaMask mobile: data.originalError.code = 4902 under -32603). */
function walletErrorCodes(e: unknown): number[] {
  const o = e as { code?: unknown; data?: { originalError?: { code?: unknown }; code?: unknown }; cause?: { code?: unknown } } | null;
  return [o?.code, o?.data?.originalError?.code, o?.data?.code, o?.cause?.code].filter((c): c is number => typeof c === "number");
}

/** Readable message from any wallet/RPC error (not all wallets throw Error instances). */
export function walletErrorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  const o = e as { shortMessage?: string; message?: string; data?: { message?: string; originalError?: { message?: string } }; reason?: string } | null;
  const m = o?.shortMessage || o?.data?.originalError?.message || o?.data?.message || o?.reason || o?.message;
  return (typeof m === "string" && m) || "Wallet error";
}

export const isUserRejection = (e: unknown) => walletErrorCodes(e).includes(4001) || /user (rejected|denied|cancel)|rejected by user|request rejected|denied transaction/i.test(walletErrorMessage(e));

const chainIdOf = async (p: Eip1193) => Number(await p.request({ method: "eth_chainId" }));

/**
 * Switch the wallet to `chainId`, adding the network first when the wallet
 * doesn't know it (error 4902 — common for Base and BNB Chain), then wait
 * until the wallet actually reports it (some switch asynchronously).
 */
export async function ensureChain(p: Eip1193, chainId: number) {
  if ((await chainIdOf(p)) === chainId) return;
  const name = ADD_CHAIN[chainId]?.chainName ?? `chain ${chainId}`;
  const switchTo = () => p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(BigInt(chainId)) }] });
  try {
    await switchTo();
  } catch (e) {
    if (isUserRejection(e)) throw new Error(`You declined switching to ${name}.`);
    const unknown = walletErrorCodes(e).includes(4902) || /4902|unrecognized chain|unknown chain|not been added|not added|add (it|the chain|this network) first|unsupported chain/i.test(walletErrorMessage(e));
    if (!unknown || !ADD_CHAIN[chainId]) throw new Error(`Couldn't switch your wallet to ${name}: ${walletErrorMessage(e).slice(0, 160)}`);
    try {
      await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex(BigInt(chainId)), ...ADD_CHAIN[chainId] }] });
    } catch (e2) {
      if (isUserRejection(e2)) throw new Error(`You declined adding ${name} to your wallet.`);
      throw new Error(`Couldn't add ${name} to your wallet: ${walletErrorMessage(e2).slice(0, 160)}`);
    }
    // Most wallets switch on add (sometimes a moment later); others need the switch again.
    let on = false;
    for (let i = 0; i < 6 && !on; i++) { on = (await chainIdOf(p).catch(() => 0)) === chainId; if (!on) await sleep(250); }
    if (!on) {
      try { await switchTo(); } catch (e3) {
        if (isUserRejection(e3)) throw new Error(`You declined switching to ${name}.`);
        throw new Error(`Couldn't switch your wallet to ${name}: ${walletErrorMessage(e3).slice(0, 160)}`);
      }
    }
  }
  for (let i = 0; i < 20; i++) {
    if ((await chainIdOf(p).catch(() => 0)) === chainId) return;
    await sleep(250);
  }
  throw new Error(`Your wallet is still on another network. Switch it to ${name} and try again.`);
}

const big = (v: unknown) => BigInt(typeof v === "string" || typeof v === "number" || typeof v === "bigint" ? v : "0x0");

export type DeployQuote = { ok: true; gas: bigint; costWei: bigint | null } | { ok: false; error: string };

/**
 * Simulate the deployment and estimate its cost with the wallet's own node.
 * costWei is the expected fee with a 20% margin (null when the wallet exposes
 * no fee data — the wallet then shows it when signing).
 */
export async function quoteDeploy(p: Eip1193, from: string, data: string, native = "ETH"): Promise<DeployQuote> {
  let gas: bigint;
  try {
    await p.request({ method: "eth_call", params: [{ from, data }, "latest"] });
    gas = big(await p.request({ method: "eth_estimateGas", params: [{ from, data }] }));
  } catch (e) {
    const m = walletErrorMessage(e);
    return { ok: false, error: /insufficient funds|insufficient balance/i.test(m) ? `Not enough ${native} to pay for gas.` : `The deployment would fail: ${m.slice(0, 200)}` };
  }
  // Fee per gas: EIP-1559 (base fee + tip) when available, else eth_gasPrice; either may be unsupported.
  const [block, tip, gasPrice] = await Promise.all([
    p.request({ method: "eth_getBlockByNumber", params: ["latest", false] }).then((b) => (b as { baseFeePerGas?: string } | null)?.baseFeePerGas).catch(() => undefined),
    p.request({ method: "eth_maxPriorityFeePerGas" }).then(big).catch(() => null),
    p.request({ method: "eth_gasPrice" }).then(big).catch(() => null),
  ]);
  const eip1559 = block ? big(block) + (tip ?? BigInt(0)) : null;
  const price = eip1559 !== null && gasPrice !== null ? (eip1559 > gasPrice ? eip1559 : gasPrice) : eip1559 ?? gasPrice;
  if (price === null || price === BigInt(0)) return { ok: true, gas, costWei: null };
  const expected = gas * price;
  try {
    const bal = big(await p.request({ method: "eth_getBalance", params: [from, "latest"] }));
    if (bal < expected) return { ok: false, error: `Not enough ${native} to pay for gas: about ${formatEther(expected)} ${native} needed, your wallet has ${formatEther(bal)} ${native}.` };
  } catch { /* balance unavailable — the wallet will check */ }
  return { ok: true, gas, costWei: (expected * BigInt(12)) / BigInt(10) };
}

type Receipt = { status: string; contractAddress: string | null };

/** Receipt via Bajar's read-only relay (fallback when the wallet's node lags or returns null). */
async function relayReceipt(chain: string, hash: string): Promise<Receipt | null> {
  const r = await fetch("/api/wallet/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, method: "eth_getTransactionReceipt", params: [hash] }) });
  const b = await r.json().catch(() => null) as { result?: Receipt | null } | null;
  return b?.result ?? null;
}

/**
 * Poll for the receipt (~6 min). Wallet nodes (WalletConnect especially) can
 * return null or error for a while; with `chain` set, Bajar's relay is asked
 * too. Status is normalized to "0x1" / "0x0".
 */
export async function waitReceipt(p: Eip1193, hash: string, chain?: string, tries = 120): Promise<Receipt> {
  for (let i = 0; i < tries; i++) {
    let r = await p.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null) as Receipt | null;
    if (!r && chain && i % 2 === 1) r = await relayReceipt(chain, hash).catch(() => null);
    if (r && r.status != null) return { status: Number(r.status) === 1 ? "0x1" : "0x0", contractAddress: r.contractAddress ?? null };
    await sleep(3000);
  }
  throw new Error("Still waiting for confirmation — check the transaction in the explorer before trying again.");
}

export const burnData = (amountWhole: string) => encodeFunctionData({ abi: BAJAR_TOKEN_ABI, functionName: "burn", args: [parseUnits(amountWhole, 18)] });

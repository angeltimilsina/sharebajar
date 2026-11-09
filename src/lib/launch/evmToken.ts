"use client";
import { encodeDeployData, encodeFunctionData, parseUnits } from "viem";
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

export async function ensureChain(p: Eip1193, chainId: number) {
  const cur = Number(await p.request({ method: "eth_chainId" }));
  if (cur !== chainId) await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(BigInt(chainId)) }] });
}

/** Simulate the deployment and estimate its cost with the wallet's own node. */
export async function quoteDeploy(p: Eip1193, from: string, data: string): Promise<{ ok: true; gas: bigint; costWei: bigint } | { ok: false; error: string }> {
  try {
    await p.request({ method: "eth_call", params: [{ from, data }, "latest"] });
    const gas = BigInt(await p.request({ method: "eth_estimateGas", params: [{ from, data }] }) as string);
    const price = BigInt(await p.request({ method: "eth_gasPrice" }) as string);
    return { ok: true, gas, costWei: (gas * price * BigInt(12)) / BigInt(10) };
  } catch (e) {
    const m = (e as Error).message ?? String(e);
    return { ok: false, error: /insufficient/i.test(m) ? "Not enough native balance to pay for gas." : m.slice(0, 200) };
  }
}

export async function waitReceipt(p: Eip1193, hash: string, tries = 90): Promise<{ status: string; contractAddress: string | null }> {
  for (let i = 0; i < tries; i++) {
    const r = await p.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null) as { status: string; contractAddress: string | null } | null;
    if (r) return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error("Still waiting for confirmation — check the explorer.");
}

export const burnData = (amountWhole: string) => encodeFunctionData({ abi: BAJAR_TOKEN_ABI, functionName: "burn", args: [parseUnits(amountWhole, 18)] });

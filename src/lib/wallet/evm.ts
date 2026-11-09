"use client";

/** EIP-1193 provider + EIP-6963 multi-wallet discovery. */
import { wcProvider } from "./walletconnect";
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, cb: (...a: unknown[]) => void): void;
  removeListener?(event: string, cb: (...a: unknown[]) => void): void;
  isMetaMask?: boolean;
}

export interface Eip6963Info { uuid: string; name: string; icon: string; rdns: string }
export interface DiscoveredEvm { info: Eip6963Info; provider: Eip1193 }

declare global {
  interface Window { ethereum?: Eip1193 & { providers?: Eip1193[] } }
  interface WindowEventMap { "eip6963:announceProvider": CustomEvent<DiscoveredEvm> }
}

const found = new Map<string, DiscoveredEvm>();
const listeners = new Set<() => void>();
let started = false;
let snapshot: DiscoveredEvm[] = [];

export function startEvmDiscovery() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("eip6963:announceProvider", (e) => {
    const d = e.detail;
    if (!d?.info?.rdns || found.has(d.info.rdns)) return;
    found.set(d.info.rdns, d);
    snapshot = [...found.values()];
    listeners.forEach((l) => l());
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export const evmDiscovery = {
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  get: () => snapshot,
};

/** Find a provider by EIP-6963 rdns, falling back to legacy window.ethereum. */
export function getEvmProvider(id: string): Eip1193 | undefined {
  if (id.startsWith("wc:")) return wcProvider();
  if (id === "bajar.evm") return typeof window !== "undefined" ? (window.bajar?.evm as Eip1193 | undefined) : undefined;
  const d = found.get(id);
  if (d) return d.provider;
  if (id === "io.metamask" && typeof window !== "undefined" && window.ethereum?.isMetaMask) return window.ethereum;
  if (id === "injected" && typeof window !== "undefined") return window.ethereum;
  // Inside Coinbase / Trust in-app browsers the wallet may only inject window.ethereum.
  const eth = typeof window !== "undefined" ? (window.ethereum as (Eip1193 & { isCoinbaseWallet?: boolean; isTrust?: boolean; isTrustWallet?: boolean }) | undefined) : undefined;
  if (id === "com.coinbase.wallet" && eth?.isCoinbaseWallet) return eth;
  if (id === "com.trustwallet.app" && (eth?.isTrust || eth?.isTrustWallet)) return eth;
  return undefined;
}

export async function evmSignMessage(p: Eip1193, address: string, message: string): Promise<string> {
  const hex = `0x${Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  return (await p.request({ method: "personal_sign", params: [hex, address] })) as string;
}

export async function evmNativeBalance(p: Eip1193, address: string): Promise<number> {
  const hex = (await p.request({ method: "eth_getBalance", params: [address, "latest"] })) as string;
  return Number(BigInt(hex)) / 1e18;
}

"use client";
import { isValidAddressFor, getChain } from "../chains";

/**
 * Every wallet the user has brought to Bajar on this device — connected
 * wallets, the Bajar Wallet's addresses, and watch-only addresses. Public
 * addresses only; nothing here can sign. Stored in this browser.
 */
export type WalletChain = "solana" | "evm" | "bitcoin";
export type WalletSource = "connected" | "bajar" | "watch" | "linked";

export interface TrackedWallet {
  id: string;            // `${chain}:${address}` (EVM lowercased)
  address: string;
  chain: WalletChain;
  label: string;
  source: WalletSource;
  /** Provider id for connected wallets (to know which one can sign). */
  walletId?: string;
  /** Proven by signature and saved to the user's Bajar profile. */
  verified?: boolean;
  addedAt: number;
}

const KEY = "bajar.wallets.v1";
const subs = new Set<() => void>();
let cache: { wallets: TrackedWallet[] } | null = null;

const load = () => {
  if (cache) return cache;
  let wallets: TrackedWallet[] = [];
  try { wallets = JSON.parse(localStorage.getItem(KEY) ?? "[]"); localStorage.removeItem("bajar.walletmaps.v1"); } catch { /* blocked */ }
  return (cache = { wallets: Array.isArray(wallets) ? wallets : [] });
};
const save = (next: { wallets: TrackedWallet[] }) => {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next.wallets)); } catch { /* blocked */ }
  subs.forEach((f) => f());
};

export const walletId = (chain: WalletChain, address: string) => `${chain}:${chain === "evm" ? address.toLowerCase() : address}`;

export const registry = {
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  snapshot: () => load(),
  /** Add or refresh a wallet (keeps the user's label). */
  upsert(w: Omit<TrackedWallet, "id" | "addedAt"> & { addedAt?: number }) {
    const s = load();
    const id = walletId(w.chain, w.address);
    const prev = s.wallets.find((x) => x.id === id);
    const entry: TrackedWallet = { ...w, id, label: prev?.label ?? w.label, addedAt: prev?.addedAt ?? w.addedAt ?? Date.now(), source: (prev?.source === "watch" || prev?.source === "linked") && w.source !== "watch" && w.source !== "linked" ? w.source : prev?.source === "watch" && w.source === "linked" ? "linked" : prev?.source ?? w.source, verified: w.verified ?? prev?.verified };
    if (entry.verified === undefined) delete entry.verified;
    if (prev && JSON.stringify(prev) === JSON.stringify(entry)) return;
    save({ ...s, wallets: prev ? s.wallets.map((x) => (x.id === id ? entry : x)) : [...s.wallets, entry] });
  },
  rename(id: string, label: string) { const s = load(); save({ ...s, wallets: s.wallets.map((w) => (w.id === id ? { ...w, label: label.slice(0, 40) || w.label } : w)) }); },
  remove(id: string) { const s = load(); save({ wallets: s.wallets.filter((w) => w.id !== id) }); },
};

/** Validate a pasted address and work out which chain family it belongs to. */
export function detectWatchAddress(input: string): { chain: WalletChain; address: string } | null {
  const a = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return { chain: "evm", address: a };
  if (/^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a)) return { chain: "bitcoin", address: a };
  const sol = getChain("solana");
  if (sol && isValidAddressFor(sol, a)) return { chain: "solana", address: a };
  return null;
}

export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

"use client";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../wallet/WalletProvider";
import { getSolanaProvider, solanaSignMessage } from "@/lib/wallet/solana";
import { evmSignMessage, getEvmProvider } from "@/lib/wallet/evm";

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(path, { method: init?.method ?? (init?.body ? "POST" : "GET"), headers: init?.body ? { "content-type": "application/json" } : undefined, body: init?.body ? JSON.stringify(init.body) : undefined, cache: "no-store" });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.error ?? `Request failed (${r.status})`), { status: r.status });
  return b as T;
}

export interface Me {
  actor: { address: string; role: "viewer" | "operator" | "admin" | "owner"; chainType: string; fresh: boolean; source: string } | null;
  config: { requiredApprovals: number; ownersConfigured: number; database: string; devEncryptionKey: boolean; defaultFeeBps: number; maxFeeBps: number; crossChainFeeBps?: number; launchFee?: { enabled: boolean; amountUsdc: number; note: string }; rules: Record<string, { min: number; max: number; providerShareBps: number; label: string }>; jupiterApiKey: boolean; zeroXApiKey: boolean; alertWebhook: boolean; cron: boolean; freshMinutes: number };
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => api<Me>("/api/treasury/me").then(setMe).catch((e) => setError(e.message)), []);
  useEffect(() => { reload(); }, [reload]);
  return { me, error, reload };
}

const RANK = { viewer: 1, operator: 2, admin: 3, owner: 4 } as const;
export const can = (me: Me | null, role: keyof typeof RANK) => !!me?.actor && RANK[me.actor.role] >= RANK[role];

/** Sign a human-readable message with the currently connected wallet. */
export function useSigner() {
  const { wallet } = useWallet();
  const sign = useCallback(async (message: string): Promise<{ signer: string; signature: string }> => {
    if (!wallet) throw new Error("Connect a wallet first.");
    if (wallet.chainType === "solana") {
      const p = getSolanaProvider(wallet.walletId);
      if (!p) throw new Error("Wallet unavailable");
      return { signer: wallet.address, signature: await solanaSignMessage(p, message) };
    }
    const p = getEvmProvider(wallet.walletId);
    if (!p) throw new Error("Wallet unavailable");
    return { signer: wallet.address, signature: await evmSignMessage(p, wallet.address, message) };
  }, [wallet]);
  return { sign, wallet };
}

/** Propose a governed change: prepare → sign with wallet → submit. */
export function usePropose() {
  const { sign } = useSigner();
  return useCallback(async (action: string, payload: Record<string, unknown>) => {
    const prep = await api<{ message: string; issuedAt: string }>("/api/treasury/changes", { body: { prepare: true, action, payload } });
    const { signature } = await sign(prep.message);
    return api<{ change: { id: string; status: string } }>("/api/treasury/changes", { body: { action, payload, issuedAt: prep.issuedAt, signature } });
  }, [sign]);
}

export const fmtUsd = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2 }));
export const STATUS_TONE: Record<string, "neutral" | "up" | "down" | "warn" | "brand" | "info"> = {
  registered: "neutral", verified: "info", validated: "brand", testing: "warn", active: "up", disabled: "down",
  confirmed: "up", pending: "warn", reverted: "down", orphaned: "down", matched: "up", under: "down", over: "warn", unexpected: "info", not_applicable: "neutral",
  fee_received: "up", fee_missing: "down", failed: "down", dropped: "down", no_fee: "neutral", submitted: "warn", applied: "up", rejected: "down",
};
export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];

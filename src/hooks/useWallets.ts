"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { registry, type TrackedWallet } from "@/lib/wallets/registry";

const EMPTY = { wallets: [] as TrackedWallet[] };

/** Live view of tracked wallets on this device. */
export function useRegistry() {
  return useSyncExternalStore(registry.subscribe, registry.snapshot, () => EMPTY);
}

export interface WalletHolding { network: string; networkName: string; token: string; symbol: string; name: string; decimals?: number; amountRaw?: string; amount: number; usdPrice: number | null; usdValue: number | null; change24h?: number | null; native: boolean; wrappedBtc?: boolean }
export interface WalletBalance { wallet: TrackedWallet; totalUsd: number | null; holdings: WalletHolding[]; error: string | null }

const param = (w: TrackedWallet) => (w.chain === "solana" ? "sol" : w.chain === "evm" ? "evm" : "btc");

/**
 * Balances for a set of wallets, read from the chains by Bajar's server
 * (public addresses only). Refreshes every 60s while the page is visible.
 */
export function useWalletBalances(wallets: TrackedWallet[]) {
  const key = wallets.map((w) => w.id).sort().join(",");
  const [state, setState] = useState<{ balances: WalletBalance[]; loading: boolean; at: number | null }>({ balances: [], loading: true, at: null });
  useEffect(() => {
    if (!wallets.length) { setState({ balances: [], loading: false, at: null }); return; }
    let alive = true;
    const run = async () => {
      setState((s) => ({ ...s, loading: true }));
      const res = await Promise.allSettled(wallets.map(async (w): Promise<WalletBalance> => {
        const r = await fetch(`/api/wallet/portfolio?${param(w)}=${encodeURIComponent(w.address)}`);
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
        const hs = ((b.data?.holdings ?? []) as WalletHolding[]).filter((h) => h.amount > 0);
        return { wallet: w, totalUsd: b.data?.totalUsd ?? 0, holdings: hs, error: null };
      }));
      if (!alive) return;
      setState({ balances: res.map((r, i) => (r.status === "fulfilled" ? r.value : { wallet: wallets[i], totalUsd: null, holdings: [], error: String((r.reason as Error)?.message ?? r.reason) })), loading: false, at: Date.now() });
    };
    run();
    const t = setInterval(() => { if (document.visibilityState === "visible") run(); }, 60_000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const totals = useMemo(() => {
    const total = state.balances.reduce((s, b) => s + (b.totalUsd ?? 0), 0);
    const all = state.balances.flatMap((b) => b.holdings);
    return { total, holdings: all };
  }, [state.balances]);
  return { ...state, ...totals };
}

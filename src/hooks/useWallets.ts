"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { registry, type TrackedWallet } from "@/lib/wallets/registry";

const EMPTY = { wallets: [] as TrackedWallet[] };

/** Live view of tracked wallets on this device. */
export function useRegistry() {
  return useSyncExternalStore(registry.subscribe, registry.snapshot, () => EMPTY);
}

export interface WalletHolding { network: string; networkName: string; token: string; symbol: string; name: string; decimals?: number; amountRaw?: string; amount: number; usdPrice: number | null; usdValue: number | null; change24h?: number | null; native: boolean; wrappedBtc?: boolean; icon?: string | null }
export interface WalletBalance { wallet: TrackedWallet; totalUsd: number | null; holdings: WalletHolding[]; error: string | null }

const param = (w: TrackedWallet) => (w.chain === "solana" ? "sol" : w.chain === "evm" ? "evm" : "btc");

/** One-off read of balances for these wallets (public addresses only). */
export async function fetchBalances(wallets: TrackedWallet[]): Promise<WalletBalance[]> {
  const res = await Promise.allSettled(wallets.map(async (w): Promise<WalletBalance> => {
    const r = await fetch(`/api/wallet/portfolio?${param(w)}=${encodeURIComponent(w.address)}`);
    const b = await r.json();
    if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
    const hs = ((b.data?.holdings ?? []) as WalletHolding[]).filter((h) => h.amount > 0);
    return { wallet: w, totalUsd: b.data?.totalUsd ?? 0, holdings: hs, error: null };
  }));
  return res.map((r, i) => (r.status === "fulfilled" ? r.value : { wallet: wallets[i], totalUsd: null, holdings: [], error: String((r.reason as Error)?.message ?? r.reason) }));
}

/**
 * Balances for a set of wallets, read from the chains by Bajar's server
 * (public addresses only). Refreshes every 60s while the page is visible.
 */
export function useWalletBalances(wallets: TrackedWallet[]) {
  const key = wallets.map((w) => w.id).sort().join(",");
  const [state, setState] = useState<{ balances: WalletBalance[]; loading: boolean; at: number | null }>({ balances: [], loading: true, at: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!wallets.length) { setState({ balances: [], loading: false, at: null }); return; }
    let alive = true;
    const run = async () => {
      setState((s) => ({ ...s, loading: true }));
      const balances = await fetchBalances(wallets);
      if (!alive) return;
      setState({ balances, loading: false, at: Date.now() });
    };
    run();
    const t = setInterval(() => { if (document.visibilityState === "visible") run(); }, 60_000);
    // Coming back to the app (e.g. from a wallet app on a phone): refresh right away.
    let lastRun = Date.now();
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - lastRun > 5000) { lastRun = Date.now(); run(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const totals = useMemo(() => {
    const total = state.balances.reduce((s, b) => s + (b.totalUsd ?? 0), 0);
    const all = state.balances.flatMap((b) => b.holdings);
    return { total, holdings: all };
  }, [state.balances]);
  return { ...state, ...totals, refresh: () => setTick((t) => t + 1) };
}

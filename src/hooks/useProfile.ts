"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useWallet } from "@/components/wallet/WalletProvider";

export interface ProfileWallet { address: string; chainType: "solana" | "evm"; label: string | null; verifiedAt: string }
export interface ProfileState {
  loaded: boolean;
  signedIn: boolean;
  address?: string;
  profile?: { id: string; wallets: ProfileWallet[]; plan: { tier: "free" | "pro"; until: string | null } };
  pricing?: { priceUsdc: number; periodDays: number; linkLimit: number; recipient: string | null; token: string; chain: string };
  error?: string;
}

let state: ProfileState = { loaded: false, signedIn: false };
const subs = new Set<() => void>();
let inflight: Promise<void> | null = null;
const set = (s: ProfileState) => { state = s; subs.forEach((f) => f()); };

export function refreshProfile(): Promise<void> {
  inflight ??= fetch("/api/profile", { cache: "no-store" })
    .then((r) => r.json())
    .then((b) => set({ loaded: true, ...b }))
    .catch(() => set({ ...state, loaded: true, error: "Couldn't load your profile." }))
    .finally(() => { inflight = null; });
  return inflight;
}

/** The signed-in wallet's Bajar profile (linked wallets, plan). Reloads when the session changes. */
export function useProfile() {
  const { session } = useWallet();
  const s = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state, () => state);
  useEffect(() => { void refreshProfile(); }, [session?.address]);
  return { ...s, isPro: s.profile?.plan.tier === "pro", refresh: refreshProfile };
}

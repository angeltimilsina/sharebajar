"use client";
import { useSyncExternalStore } from "react";
import { bajar } from "@/lib/bajar/session";

/** Re-renders when the BAJAR session changes (unlock/lock/settings). */
export function useBajar() {
  useSyncExternalStore(bajar.subscribe, bajar.version, () => 0);
  return { hasVault: typeof window !== "undefined" && bajar.hasVault(), unlocked: bajar.isUnlocked(), accounts: bajar.accounts() };
}

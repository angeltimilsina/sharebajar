"use client";
import { useSyncExternalStore } from "react";

/** Open state of the header Account menu (also opened from the phone tab bar). */
const subs = new Set<() => void>();
let open = false;
export const accountMenu = {
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  get: () => open,
  set(v: boolean) { open = v; subs.forEach((f) => f()); },
  toggle() { accountMenu.set(!open); },
};
export function useAccountMenu() { return useSyncExternalStore(accountMenu.subscribe, accountMenu.get, () => false); }

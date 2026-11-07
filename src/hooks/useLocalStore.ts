"use client";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Tiny localStorage-backed store shared across components and tabs.
 * Fails soft when storage is unavailable (private mode etc.).
 */
const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, string | null>();

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  let v: string | null = null;
  try { v = localStorage.getItem(key); } catch { /* ignore */ }
  memory.set(key, v);
  return v;
}

function write(key: string, value: string) {
  memory.set(key, value);
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
  listeners.get(key)?.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!e.key) return;
    memory.delete(e.key);
    listeners.get(e.key)?.forEach((l) => l());
  });
}

export function useLocalStore<T>(key: string, fallback: T): [T, (updater: T | ((prev: T) => T)) => void] {
  const subscribe = useCallback((cb: () => void) => {
    const set = listeners.get(key) ?? new Set();
    set.add(cb);
    listeners.set(key, set);
    return () => set.delete(cb);
  }, [key]);
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  let value = fallback;
  if (raw) { try { value = JSON.parse(raw) as T; } catch { /* ignore */ } }
  const set = useCallback((updater: T | ((prev: T) => T)) => {
    let prev = fallback;
    const r = read(key);
    if (r) { try { prev = JSON.parse(r) as T; } catch { /* ignore */ } }
    const next = typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater;
    write(key, JSON.stringify(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, set];
}

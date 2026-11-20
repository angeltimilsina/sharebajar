"use client";
import { useLocalStore } from "./useLocalStore";

export type WatchItem =
  | { kind: "coin"; id: string; label: string; addedAt: number }
  | { kind: "token"; id: string; chain: string; address: string; label: string; addedAt: number };

export type WatchInput = WatchItem extends infer T ? (T extends WatchItem ? Omit<T, "addedAt"> : never) : never;

export const watchKey = (i: { kind: string; id?: string; chain?: string; address?: string }) =>
  i.kind === "coin" ? `coin:${i.id}` : `token:${i.chain}:${i.address}`;

export function useWatchlist() {
  const [items, setItems] = useLocalStore<WatchItem[]>("sb.watchlist.v1", []);
  const has = (k: string) => items.some((i) => watchKey(i) === k);
  const toggle = (item: WatchInput) => {
    const k = watchKey(item);
    setItems((prev) => (prev.some((i) => watchKey(i) === k) ? prev.filter((i) => watchKey(i) !== k) : [...prev, { ...item, addedAt: Date.now() } as WatchItem]));
  };
  const addMany = (list: WatchInput[]) =>
    setItems((prev) => {
      const keys = new Set(prev.map(watchKey));
      return [...prev, ...list.filter((i) => !keys.has(watchKey(i))).map((i) => ({ ...i, addedAt: Date.now() }) as WatchItem)];
    });
  const remove = (k: string) => setItems((prev) => prev.filter((i) => watchKey(i) !== k));
  return { items, has, toggle, addMany, remove };
}

export interface PriceAlert {
  id: string;
  label: string;
  target: { kind: "coin" | "token"; id: string; chain?: string; address?: string };
  condition: "above" | "below";
  price: number;
  createdAt: number;
  triggeredAt: number | null;
}

export function useAlerts() {
  const [alerts, setAlerts] = useLocalStore<PriceAlert[]>("sb.alerts.v1", []);
  const add = (a: Omit<PriceAlert, "id" | "createdAt" | "triggeredAt">) =>
    setAlerts((prev) => [...prev, { ...a, id: Math.random().toString(36).slice(2), createdAt: Date.now(), triggeredAt: null }]);
  const remove = (id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id));
  const markTriggered = (id: string) => setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, triggeredAt: Date.now() } : a)));
  return { alerts, add, remove, markTriggered };
}

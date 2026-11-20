"use client";
import { useEffect, useRef } from "react";
import { useAlerts } from "@/hooks/useWatchlist";

/** Checks price alerts every 30s using real prices while the app is open. */
export function AlertWatcher() {
  const { alerts, markTriggered } = useAlerts();
  const ref = useRef(alerts);
  ref.current = alerts;
  useEffect(() => {
    const check = async () => {
      const active = ref.current.filter((a) => !a.triggeredAt);
      if (!active.length) return;
      const coinIds = active.filter((a) => a.target.kind === "coin").map((a) => a.target.id);
      const prices: Record<string, number> = {};
      if (coinIds.length) {
        const r = await fetch(`/api/market/coins?ids=${[...new Set(coinIds)].join(",")}`).then((x) => x.json()).catch(() => null);
        for (const c of r?.data ?? []) if (c.price) prices[`coin:${c.id}`] = c.price;
      }
      for (const a of active.filter((x) => x.target.kind === "token" && x.target.chain && x.target.address)) {
        const r = await fetch(`/api/dex/pairs?chain=${a.target.chain}&address=${a.target.address}`).then((x) => x.json()).catch(() => null);
        if (r?.data?.[0]?.priceUsd) prices[`token:${a.target.chain}:${a.target.address}`] = r.data[0].priceUsd;
      }
      for (const a of active) {
        const key = a.target.kind === "coin" ? `coin:${a.target.id}` : `token:${a.target.chain}:${a.target.address}`;
        const p = prices[key];
        if (p === undefined) continue;
        if ((a.condition === "above" && p >= a.price) || (a.condition === "below" && p <= a.price)) {
          markTriggered(a.id);
          const body = `${a.label} is ${a.condition} ${a.price} (now ${p})`;
          if ("Notification" in window && Notification.permission === "granted") new Notification("Bajar price alert", { body });
          window.dispatchEvent(new CustomEvent("sb-toast", { detail: body }));
        }
      }
    };
    const t = setInterval(check, 30_000);
    const first = setTimeout(check, 3000);
    return () => { clearInterval(t); clearTimeout(first); };
  }, [markTriggered]);
  return null;
}

"use client";
import { useEffect, useState } from "react";

let cache: Record<string, string> | null = null;
let pending: Promise<Record<string, string>> | null = null;

/** Base asset → Binance USDT pair, fetched once per session. */
export function useBinanceSymbols(): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>(cache ?? {});
  useEffect(() => {
    if (cache) return;
    pending ??= fetch("/api/binance/symbols").then((r) => r.json()).then((e) => (cache = e.data ?? {})).catch(() => ({}));
    pending.then(setMap);
  }, []);
  return map;
}

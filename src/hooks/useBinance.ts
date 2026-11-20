"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { binanceStream, type StreamStatus, type WsMiniTicker } from "@/lib/stream/binance-ws";

export function useStreamStatus(): StreamStatus {
  const s = binanceStream();
  return useSyncExternalStore((cb) => s.onStatus(cb), () => s.status, () => "idle");
}

/** Subscribe to a Binance stream; handler always sees the latest closure. */
export function useBinanceSubscription<T>(stream: string | null, handler: (data: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!stream) return;
    return binanceStream().subscribe(stream, (d) => ref.current(d as T));
  }, [stream]);
}

export interface LiveTicker { price: number; open24h: number; change24h: number; updatedAt: number }

/**
 * Live prices for Binance USDT symbols (e.g. BTCUSDT). Seeds from REST, then
 * streams 24h mini-tickers (~1/s per symbol). Updates are batched per frame.
 */
export function useLiveTickers(symbols: string[]): Record<string, LiveTicker> {
  const [map, setMap] = useState<Record<string, LiveTicker>>({});
  const key = [...new Set(symbols)].sort().join(",");
  const buffer = useRef<Record<string, LiveTicker>>({});
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!key) return;
    const list = key.split(",");
    let cancelled = false;
    fetch(`/api/binance/tickers?symbols=${key}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((env) => {
        if (cancelled || !env?.data) return;
        setMap((m) => {
          const next = { ...m };
          for (const t of env.data as { symbol: string; price: number; change24h: number }[]) {
            if (!next[t.symbol]) next[t.symbol] = { price: t.price, open24h: t.price / (1 + (t.change24h || 0) / 100), change24h: t.change24h, updatedAt: env.fetchedAt };
          }
          return next;
        });
      })
      .catch(() => {});
    const flush = () => {
      raf.current = null;
      const b = buffer.current;
      buffer.current = {};
      setMap((m) => ({ ...m, ...b }));
    };
    const unsubs = list.map((sym) =>
      binanceStream().subscribe(`${sym.toLowerCase()}@miniTicker`, (d) => {
        const t = d as WsMiniTicker;
        const price = Number(t.c);
        const open = Number(t.o);
        buffer.current[t.s] = { price, open24h: open, change24h: open ? ((price - open) / open) * 100 : 0, updatedAt: t.E };
        raf.current ??= requestAnimationFrame(flush);
      }),
    );
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [key]);

  return map;
}

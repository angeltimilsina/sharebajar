"use client";
import { useEffect, useRef, useState } from "react";
import { aggregateCandles, applyTrade, candlesFromTrades, mergeTrades, RESOLUTION_SECONDS, rollLatest, upsertCandle } from "@/lib/analytics/candles";
import { binanceStream, type WsAggTrade, type WsKline } from "@/lib/stream/binance-ws";
import type { Candle, Trade } from "@/lib/types";

export type Feed =
  | { kind: "binance"; symbol: string }
  | { kind: "dex"; chain: string; pool: string };

export const RESOLUTIONS: Record<Feed["kind"], string[]> = {
  binance: ["1s", "5s", "15s", "1m", "5m", "15m", "1h", "4h", "1d", "1w"],
  dex: ["1s", "5s", "15s", "1m", "5m", "15m", "1h", "4h", "1d"],
};

export interface FeedState {
  candles: Candle[];
  /** Recent trades (newest first) — Binance aggTrades or DEX swaps. */
  trades: Trade[];
  loading: boolean;
  error: string | null;
  /** When we last received data from the source (ms). */
  lastUpdate: number | null;
  /** Expected cadence of updates (ms) for freshness evaluation. */
  expectedMs: number;
  mode: "stream" | "poll";
  source: string;
  /** For DEX sub-minute candles: oldest trade we have. */
  coverageFrom: number | null;
}

const DEX_POLL_MS = 4000;

async function getJson<T>(url: string): Promise<{ data: T; fetchedAt: number; stale: boolean }> {
  const r = await fetch(url);
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error ?? `Request failed (${r.status})`);
  return b;
}

export function useCandleFeed(feed: Feed, res: string, opts: { trades?: boolean } = {}): FeedState {
  const wantTrades = opts.trades ?? true;
  const [state, setState] = useState<FeedState>({ candles: [], trades: [], loading: true, error: null, lastUpdate: null, expectedMs: 2000, mode: "stream", source: "", coverageFrom: null });
  const feedKey = feed.kind === "binance" ? `b:${feed.symbol}` : `d:${feed.chain}:${feed.pool}`;
  const gen = useRef(0);

  useEffect(() => {
    const my = ++gen.current;
    const alive = () => gen.current === my;
    const cleanups: (() => void)[] = [];
    setState((s) => ({ ...s, candles: [], loading: true, error: null, coverageFrom: null, trades: feed.kind === "dex" ? s.trades : [] }));

    if (feed.kind === "binance") {
      const sym = feed.symbol.toLowerCase();
      const sec = RESOLUTION_SECONDS[res];
      const subSecond = sec < 60;
      setState((s) => ({ ...s, mode: "stream", source: "Binance", expectedMs: subSecond ? 2000 : 4000 }));
      let fine: Candle[] = [];
      let series: Candle[] = [];
      let ready = false;
      const queue: Candle[] = [];
      const histUrl = subSecond ? `/api/candles?symbol=${feed.symbol}&res=1s&pages=${res === "15s" ? 3 : res === "5s" ? 2 : 1}` : `/api/candles?symbol=${feed.symbol}&res=${res}`;
      const applyFine = (c: Candle) => {
        fine = upsertCandle(fine, c, 1, 4000);
        series = res === "1s" ? fine : rollLatest(fine, series, sec);
      };
      const unsubK = binanceStream().subscribe(`${sym}@kline_${subSecond ? "1s" : res}`, (d) => {
        const k = (d as WsKline).k;
        const c: Candle = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, trades: k.n, buyVolume: +k.V };
        if (!ready) { queue.push(c); return; }
        if (subSecond) applyFine(c); else series = upsertCandle(series, c, sec);
        if (alive()) setState((s) => ({ ...s, candles: series, lastUpdate: Date.now(), error: null }));
      });
      cleanups.push(unsubK);
      getJson<Candle[]>(histUrl)
        .then((env) => {
          if (!alive()) return;
          if (subSecond) { fine = env.data; series = res === "1s" ? fine : aggregateCandles(fine, sec); }
          else series = env.data;
          ready = true;
          for (const c of queue.splice(0)) subSecond ? applyFine(c) : (series = upsertCandle(series, c, sec));
          setState((s) => ({ ...s, candles: series, loading: false, lastUpdate: s.lastUpdate ?? env.fetchedAt, error: env.stale ? "Showing cached history — upstream unavailable" : null }));
        })
        .catch((e) => alive() && setState((s) => ({ ...s, loading: false, error: String(e.message ?? e) })));
      if (wantTrades) {
        let trades: Trade[] = [];
        let raf: number | null = null;
        const unsubT = binanceStream().subscribe(`${sym}@aggTrade`, (d) => {
          const t = d as WsAggTrade;
          const price = +t.p, amount = +t.q;
          // m = buyer is maker → taker sold
          trades = [{ id: String(t.a), time: t.T, side: t.m ? "sell" : "buy", price, amount, notional: price * amount } as Trade, ...trades].slice(0, 300);
          raf ??= requestAnimationFrame(() => { raf = null; if (alive()) setState((s) => ({ ...s, trades })); });
        });
        cleanups.push(() => { unsubT(); if (raf) cancelAnimationFrame(raf); });
      }
    }

    if (feed.kind === "dex") {
      const sec = RESOLUTION_SECONDS[res];
      const subMinute = sec < 60;
      setState((s) => ({ ...s, mode: "poll", source: "GeckoTerminal (on-chain swaps)", expectedMs: DEX_POLL_MS }));
      let trades: Trade[] = [];
      let series: Candle[] = [];
      let histLoaded = subMinute;
      let seen = new Set<string>();
      const tradesUrl = `/api/dex/trades?chain=${feed.chain}&pool=${feed.pool}`;
      const poll = async () => {
        try {
          const env = await getJson<Trade[]>(tradesUrl);
          if (!alive()) return;
          const incoming = env.data;
          const fresh = incoming.filter((t) => !seen.has(t.id)).sort((a, b) => a.time - b.time);
          trades = mergeTrades(trades, incoming, 600);
          seen = new Set(trades.map((t) => t.id));
          if (subMinute) series = candlesFromTrades(trades, sec);
          else if (histLoaded) for (const t of fresh) series = applyTrade(series, t, sec);
          setState((s) => ({
            ...s, trades, candles: histLoaded ? series : s.candles, loading: !histLoaded, lastUpdate: env.fetchedAt,
            error: env.stale ? "Trade feed delayed — upstream unavailable" : null,
            coverageFrom: trades.length ? trades[trades.length - 1].time : null,
          }));
        } catch (e) {
          if (alive()) setState((s) => ({ ...s, loading: false, error: String((e as Error).message ?? e) }));
        }
      };
      if (!subMinute) {
        getJson<Candle[]>(`/api/dex/ohlcv?chain=${feed.chain}&pool=${feed.pool}&res=${res}`)
          .then((env) => {
            if (!alive()) return;
            series = env.data;
            // replay trades newer than the last history bar
            const lastT = series.length ? series[series.length - 1].time * 1000 : 0;
            for (const t of [...trades].reverse()) if (t.time >= lastT) series = applyTrade(series, t, sec);
            histLoaded = true;
            setState((s) => ({ ...s, candles: series, loading: false, lastUpdate: s.lastUpdate ?? env.fetchedAt }));
          })
          .catch((e) => alive() && setState((s) => ({ ...s, loading: false, error: String(e.message ?? e) })));
      }
      poll();
      const t = setInterval(() => { if (document.visibilityState === "visible") poll(); }, DEX_POLL_MS);
      cleanups.push(() => clearInterval(t));
    }

    return () => cleanups.forEach((c) => c());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedKey, res, wantTrades]);

  return state;
}

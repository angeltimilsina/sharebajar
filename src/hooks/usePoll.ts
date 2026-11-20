"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Envelope } from "@/lib/types";

export interface PollState<T> {
  data: T | undefined;
  /** When the upstream data was fetched (server time). */
  fetchedAt: number | null;
  source: string | null;
  /** Server served cached data because upstream failed. */
  stale: boolean;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Polls an Envelope endpoint. Keeps last good data on errors, pauses while
 * the tab is hidden, and backs off after consecutive failures.
 */
export function usePoll<T>(url: string | null, intervalMs: number, initial?: Envelope<T>): PollState<T> {
  const [env, setEnv] = useState<Envelope<T> | undefined>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initial && !!url);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const run = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    if (timer.current) clearTimeout(timer.current);
    try {
      const res = await fetch(u);
      const body = await res.json().catch(() => ({}));
      if (urlRef.current !== u) return;
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
      setEnv(body as Envelope<T>);
      setError((body as Envelope<T>).stale ? (body as Envelope<T>).error ?? "Upstream unavailable — showing cached data" : null);
      failures.current = 0;
    } catch (e) {
      if (urlRef.current !== u) return;
      failures.current++;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (urlRef.current === u) {
        setLoading(false);
        if (intervalMs > 0) {
          const backoff = Math.min(intervalMs * 2 ** failures.current, Math.max(intervalMs, 120_000));
          timer.current = setTimeout(() => {
            if (document.visibilityState === "visible") run();
            else {
              const onVis = () => { if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", onVis); run(); } };
              document.addEventListener("visibilitychange", onVis);
            }
          }, backoff);
        }
      }
    }
  }, [intervalMs]);

  const firstUrl = useRef(url);
  useEffect(() => {
    if (!url) { setEnv(undefined); setLoading(false); return; }
    // A different resource: drop the previous resource's data so the UI never
    // shows one feed's numbers under another's label.
    if (url !== firstUrl.current) { setEnv(undefined); setError(null); firstUrl.current = null; }
    setLoading(true);
    if (initial && url === firstUrl.current && Date.now() - initial.fetchedAt < intervalMs) {
      timer.current = setTimeout(run, intervalMs);
    } else run();
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, run]);

  return { data: env?.data, fetchedAt: env?.fetchedAt ?? null, source: env?.source ?? null, stale: Boolean(env?.stale), error, loading, refresh: run };
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

import type { Envelope } from "../types";
import { UpstreamError } from "./http";
import { log } from "./log";

interface Entry { value: unknown; fetchedAt: number; expiresAt: number }

const g = globalThis as unknown as { __sbCache?: Map<string, Entry>; __sbInflight?: Map<string, Promise<unknown>> };
const store = (g.__sbCache ??= new Map());
const inflight = (g.__sbInflight ??= new Map());
const MAX_ENTRIES = 2000;

export interface CacheOptions {
  /** Fresh for this long. */
  ttlMs: number;
  /** Keep serving a stale copy for this long if the upstream fails. */
  staleMs?: number;
}

/**
 * Stale-while-error cache with in-flight de-duplication.
 * Concurrent requests for the same key share one upstream call; when the
 * upstream fails we return the last good value flagged `stale: true`.
 */
export async function cached<T>(key: string, source: string, opts: CacheOptions, fetcher: () => Promise<T>): Promise<Envelope<T>> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return { data: hit.value as T, source, fetchedAt: hit.fetchedAt, stale: false };
  }

  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fetcher();
    inflight.set(key, p);
    p.finally(() => inflight.delete(key)).catch(() => {});
  }

  try {
    const value = await p;
    const fetchedAt = Date.now();
    store.set(key, { value, fetchedAt, expiresAt: fetchedAt + opts.ttlMs });
    if (store.size > MAX_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest) store.delete(oldest);
    }
    return { data: value, source, fetchedAt, stale: false };
  } catch (e) {
    const staleMs = opts.staleMs ?? 10 * 60_000;
    if (hit && now - hit.fetchedAt < staleMs) {
      log("info", "serving stale cache", { key, ageMs: now - hit.fetchedAt });
      return { data: hit.value as T, source, fetchedAt: hit.fetchedAt, stale: true, error: errorMessage(e) };
    }
    throw e;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof UpstreamError) {
    if (e.status === 429) return `${e.host} is rate-limiting requests`;
    return `${e.host} unavailable (${e.status})`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Test helper */
export function __clearCache() { store.clear(); inflight.clear(); }

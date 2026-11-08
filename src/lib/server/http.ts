import { log } from "./log";

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly host: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** Per-host cool-down after a 429 so we stop hammering a rate-limited API. */
const g = globalThis as unknown as { __sbCooldown?: Map<string, number>; __sbHostStats?: Map<string, HostStats> };
const cooldown = (g.__sbCooldown ??= new Map<string, number>());

export interface HostStats {
  host: string;
  ok: number;
  failed: number;
  lastStatus: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastAt: number | null;
}
const hostStats = (g.__sbHostStats ??= new Map<string, HostStats>());

function record(host: string, ok: boolean, status: number | null, latency: number, err?: string) {
  const s = hostStats.get(host) ?? { host, ok: 0, failed: 0, lastStatus: null, lastLatencyMs: null, lastError: null, lastAt: null };
  if (ok) s.ok++; else s.failed++;
  s.lastStatus = status;
  s.lastLatencyMs = latency;
  s.lastError = ok ? null : err ?? null;
  s.lastAt = Date.now();
  hostStats.set(host, s);
}

export const getHostStats = () => [...hostStats.values()];

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: unknown;
  /** Return raw text instead of JSON. */
  text?: boolean;
  /** Send this string as the request body verbatim (e.g. a raw transaction). */
  rawBody?: string;
}

/**
 * Minimum spacing between requests per host (free-tier rate limits). Requests
 * queue for their slot instead of failing; only a queue longer than
 * MAX_QUEUE_WAIT_MS gives up (the cache then serves the last good copy).
 */
const HOST_SPACING_MS: Record<string, number> = {
  "api.geckoterminal.com": 2_100,           // ~30 req/min free tier
  "api.gopluslabs.io": 400,
  "api.coinlore.net": 300,
};
const MAX_QUEUE_WAIT_MS = 9_000;
const nextSlot = ((globalThis as unknown as { __sbNextSlot?: Map<string, number> }).__sbNextSlot ??= new Map<string, number>());

async function waitForSlot(host: string) {
  const now = Date.now();
  // A short cool-down after a 429 is waited out rather than failed.
  const until = cooldown.get(host) ?? 0;
  if (until > now + MAX_QUEUE_WAIT_MS) throw new UpstreamError(`${host} rate-limited, cooling down`, 429, host, until - now);
  const spacing = HOST_SPACING_MS[host] ?? 0;
  const slot = Math.max(now, until, nextSlot.get(host) ?? 0);
  if (slot - now > MAX_QUEUE_WAIT_MS) throw new UpstreamError(`${host} request queue full`, 429, host, slot - now);
  nextSlot.set(host, slot + spacing);
  if (slot > now) await sleep(slot - now);
}

/**
 * fetch with timeout, retries on network errors / 5xx, per-host pacing and
 * 429 cool-down. Never caches by itself — use `cached()` on top.
 */
export async function fetchUpstream<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 8000, retries = 1, headers = {}, method = "GET", body, text, rawBody } = opts;
  const host = new URL(url).host;
  await waitForSlot(host);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method,
        headers: {
          accept: text ? "application/rss+xml, application/xml, text/xml, */*" : "application/json",
          "user-agent": "Bajar/0.1 (+https://sharebajar.app)",
          ...(body ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: rawBody ?? (body ? JSON.stringify(body) : undefined),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
        redirect: "follow",
      });
      const latency = Date.now() - started;
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 20_000;
        cooldown.set(host, Date.now() + wait);
        record(host, false, 429, latency, "rate limited");
        log("warn", "upstream rate limited", { host, waitMs: wait });
        throw new UpstreamError(`${host} rate limited`, 429, host, wait);
      }
      if (!res.ok) {
        const snippet = (await res.text().catch(() => "")).slice(0, 200);
        record(host, false, res.status, latency, snippet);
        const err = new UpstreamError(`${host} responded ${res.status}: ${snippet}`, res.status, host);
        if (res.status >= 500 && attempt < retries) { lastErr = err; await sleep(300 * (attempt + 1)); continue; }
        throw err;
      }
      const out = text ? ((await res.text()) as T) : ((await res.json()) as T);
      record(host, true, res.status, latency);
      return out;
    } catch (e) {
      if (e instanceof UpstreamError) throw e;
      lastErr = e;
      record(host, false, null, Date.now() - started, String(e));
      if (attempt < retries) { await sleep(300 * (attempt + 1)); continue; }
    }
  }
  log("warn", "upstream request failed", { host, error: String(lastErr) });
  throw new UpstreamError(`${host} unreachable: ${String(lastErr)}`, 503, host);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

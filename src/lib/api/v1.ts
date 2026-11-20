import "server-only";
import { NextResponse } from "next/server";
import { createAdapters, searchAllChains, chainById, InvalidAddressError, type ChainAdapter, type FetchJson } from "@bajar/chain-adapters";
import { fetchUpstream, UpstreamError } from "@/lib/server/http";
import { cached, errorMessage, type CacheOptions } from "@/lib/server/cache";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { log } from "@/lib/server/log";

/**
 * Public market-data API v1. Read-only, no account needed. Every response is
 * `{ data, meta: { source, fetchedAt, stale } }`; when an upstream is down and
 * nothing fresh is cached, the response says so (status 502/503) — data is
 * never simulated.
 */

// The app's fetcher gives the adapters per-host pacing, 429 cool-downs, timeouts and health metrics.
const fetchJson: FetchJson = (url, init) => fetchUpstream(url, { headers: init?.headers, timeoutMs: 12_000 });
const g = globalThis as unknown as { __sbAdapters?: Map<string, ChainAdapter> };
export const adapters = () => (g.__sbAdapters ??= createAdapters({ fetchJson, geckoTerminal: { apiKey: process.env.COINGECKO_API_KEY } }));

export const searchAll = (q: string) => searchAllChains({ fetchJson }, q);

export class ApiError extends Error { constructor(public status: number, message: string, public code = "error") { super(message); } }

export function adapterFor(chain: string): ChainAdapter {
  const a = adapters().get(chain);
  if (!a) throw new ApiError(404, `Unknown chain "${String(chain).slice(0, 32)}". See /api/v1/chains.`, "unknown_chain");
  return a;
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "x-api-key, content-type" };

/** API keys (BAJAR_API_KEYS=key1,key2) raise the per-minute limit; anonymous use is allowed. */
function limitFor(req: Request): { key: string; perMin: number } {
  const k = req.headers.get("x-api-key");
  const keys = (process.env.BAJAR_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (k && keys.includes(k)) return { key: `v1k:${k.slice(0, 12)}`, perMin: 600 };
  return { key: `v1:${clientIp(req)}`, perMin: 60 };
}

export function options() { return new NextResponse(null, { status: 204, headers: CORS }); }

/**
 * Wraps a v1 handler: rate limit, CORS, caching via the shared stale-while-error
 * cache, and consistent errors.
 */
export async function v1<T>(req: Request, cacheKey: string, cache: CacheOptions & { maxAge: number }, load: () => Promise<T>) {
  const lim = limitFor(req);
  const rl = rateLimit(lim.key, lim.perMin, lim.perMin);
  if (!rl.ok) return NextResponse.json({ error: { code: "rate_limited", message: "Too many requests." } }, { status: 429, headers: { ...CORS, "retry-after": String(rl.retryAfter) } });
  try {
    const env = await cached(`v1:${cacheKey}`, "", cache, load);
    const body = { data: env.data, meta: { source: sourceOf(env.data), fetchedAt: new Date(env.fetchedAt).toISOString(), stale: env.stale, ...(env.error ? { warning: env.error } : {}) } };
    return NextResponse.json(body, { headers: { ...CORS, "cache-control": `public, s-maxage=${cache.maxAge}, stale-while-revalidate=${cache.maxAge * 4}` } });
  } catch (e) {
    const [status, code] = e instanceof ApiError ? [e.status, e.code] : e instanceof InvalidAddressError ? [400, "invalid_address"] : e instanceof UpstreamError ? [e.status === 404 ? 404 : e.status === 429 ? 503 : 502, e.status === 404 ? "not_found" : "upstream_unavailable"] : [500, "internal"];
    if (status >= 500) log("warn", "v1 request failed", { cacheKey, error: errorMessage(e) });
    const message = e instanceof ApiError ? e.message : status === 500 ? "Internal error." : e instanceof UpstreamError && status >= 502 ? `Market data is temporarily unavailable (${errorMessage(e).slice(0, 120)}).` : errorMessage(e).slice(0, 200);
    return NextResponse.json({ error: { code, message } }, { status, headers: { ...CORS, "cache-control": "no-store", ...(e instanceof UpstreamError && e.retryAfterMs ? { "retry-after": String(Math.ceil(e.retryAfterMs / 1000)) } : {}) } });
  }
}

function sourceOf(d: unknown): string {
  const pick = (x: unknown) => (x && typeof x === "object" && "source" in x ? String((x as { source: unknown }).source) : null);
  if (Array.isArray(d)) return [...new Set(d.map(pick).filter(Boolean))].join(" + ") || "—";
  return pick(d) ?? "Bajar";
}

/** Query helpers with validation. */
export function chainParam(v: string | null): string {
  if (!v || !chainById(v)) throw new ApiError(400, "Pass a supported chain, e.g. ?chain=solana. See /api/v1/chains.", "invalid_chain");
  return v;
}
export function oneOf<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  if (v === null) return fallback;
  if (!(allowed as readonly string[]).includes(v)) throw new ApiError(400, `Expected one of: ${allowed.join(", ")}.`, "invalid_param");
  return v as T;
}

import { NextResponse } from "next/server";
import type { Envelope } from "../types";
import { UpstreamError } from "./http";
import { errorMessage } from "./cache";
import { log } from "./log";

/** Standard JSON response for envelopes, with CDN-friendly cache headers. */
export function ok<T>(env: Envelope<T>, sMaxAge = 5) {
  return NextResponse.json(env, {
    headers: { "cache-control": `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 4}` },
  });
}

export function fail(e: unknown, source?: string) {
  const status = e instanceof UpstreamError ? (e.status === 429 ? 429 : 502) : e instanceof BadRequest ? 400 : 500;
  const retryAfter = e instanceof UpstreamError && e.retryAfterMs ? Math.ceil(e.retryAfterMs / 1000) : undefined;
  if (status >= 500) log("error", "api error", { source, error: errorMessage(e) });
  return NextResponse.json(
    { error: e instanceof BadRequest ? e.message : errorMessage(e), source, retryAfter },
    { status, headers: retryAfter ? { "retry-after": String(retryAfter) } : undefined },
  );
}

export class BadRequest extends Error {}

export function param(url: URL, name: string, fallback?: string): string {
  const v = url.searchParams.get(name) ?? fallback;
  if (v === undefined || v === null || v === "") throw new BadRequest(`Missing query parameter: ${name}`);
  return v;
}

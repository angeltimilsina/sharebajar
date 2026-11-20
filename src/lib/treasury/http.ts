import "server-only";
import { NextResponse } from "next/server";
import { AccessError } from "./access";
import { log } from "../server/log";

export class TreasuryError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Uniform JSON error handling for treasury routes. */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    const data = await fn();
    return NextResponse.json(data ?? { ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AccessError || e instanceof TreasuryError) return NextResponse.json({ error: e.message }, { status: e.status, headers: { "cache-control": "no-store" } });
    log("error", "treasury route failed", { error: String(e) });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Treasury error" }, { status: 500 });
  }
}

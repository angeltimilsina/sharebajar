"use client";
/** Browser helpers for BAJAR Agents: NDJSON stream reader and the order receipts kept on this device. */
export async function streamAgents(body: unknown, onEvent: (e: Record<string, unknown> & { type: string }) => void, signal?: AbortSignal) {
  const res = await fetch("/api/agents/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const b = await res.json().catch(() => ({}));
    onEvent({ type: "error", message: b.error ?? `Request failed (${res.status})` });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { onEvent(JSON.parse(line)); } catch { /* partial */ } }
    }
  }
}

const KEY = "bajar_orders_v1";
export function orderTokens(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 50) : []; } catch { return []; }
}
export function saveOrderToken(t: string) {
  try { localStorage.setItem(KEY, JSON.stringify([t, ...orderTokens().filter((x) => x !== t)].slice(0, 50))); } catch { /* storage unavailable */ }
}
export const newIdempotencyKey = () => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").padEnd(16, "0").slice(0, 40);
export const usd = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

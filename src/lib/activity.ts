"use client";
import { getChain } from "./chains";

/**
 * One activity log for every transaction started in Bajar (trades, swaps,
 * wallet sends), from any connected wallet. Stored on this device only.
 * Pending entries are re-checked on-chain until confirmed or failed.
 */
export type ActivityStatus = "pending" | "confirmed" | "failed";
export interface Activity {
  id: string;
  chain: string;               // "solana" | "bitcoin" | EVM chain slug
  hash: string;
  kind: "trade" | "swap" | "send" | "approve" | "bridge";
  summary: string;
  wallet?: string;             // address that signed
  status: ActivityStatus;
  at: number;
  confirmedAt?: number;
  /** Asset page to return to (keeps the journey connected). */
  assetHref?: string;
}

const KEY = "bajar.activity.v1";
const EVT = "bajar-activity";

function read(): Activity[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as (Partial<Activity> & { network?: string })[];
    // Older entries (wallet v1) used `network` and had no status.
    return raw.filter((a) => a.hash).map((a) => ({
      id: a.id ?? `${a.chain ?? a.network}:${a.hash}`, chain: a.chain ?? a.network ?? "solana", hash: a.hash!, kind: a.kind ?? "send",
      summary: a.summary ?? "Transaction", wallet: a.wallet, status: a.status ?? "pending", at: a.at ?? Date.now(), confirmedAt: a.confirmedAt, assetHref: a.assetHref,
    }));
  } catch { return []; }
}
function write(list: Activity[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200))); } catch { /* storage full */ }
  window.dispatchEvent(new Event(EVT));
}

export function activities(): Activity[] { return typeof window === "undefined" ? [] : read(); }

export function addActivity(a: Omit<Activity, "id" | "status" | "at"> & { status?: ActivityStatus }) {
  const id = `${a.chain}:${a.hash}`;
  const list = read().filter((x) => x.id !== id);
  write([{ ...a, id, status: a.status ?? "pending", at: Date.now() }, ...list]);
  void refreshActivity();
}

export function subscribeActivity(fn: () => void) {
  const h = () => fn();
  window.addEventListener(EVT, h);
  window.addEventListener("storage", h);
  return () => { window.removeEventListener(EVT, h); window.removeEventListener("storage", h); };
}

export function explorerUrl(chain: string, hash: string) {
  if (chain === "bitcoin") return `https://mempool.space/tx/${hash}`;
  const c = getChain(chain);
  return c ? `${c.explorer.tx}${hash}` : "#";
}

async function rpc<T>(chain: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch("/api/wallet/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, method, params }) });
  const b = await r.json();
  if (b.error) throw new Error(b.error.message);
  return b.result as T;
}

async function statusOf(a: Activity): Promise<ActivityStatus> {
  if (a.chain === "solana") {
    const r = await rpc<{ value: ({ err: unknown; confirmationStatus: string } | null)[] }>("solana", "getSignatureStatuses", [[a.hash], { searchTransactionHistory: true }]);
    const v = r.value[0];
    if (!v) return Date.now() - a.at > 3 * 60_000 ? "failed" : "pending"; // never landed (blockhash expired)
    if (v.err) return "failed";
    return v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized" ? "confirmed" : "pending";
  }
  if (a.chain === "bitcoin") {
    const r = await fetch(`/api/wallet/btc?op=status&txid=${a.hash}`).then((x) => x.json()).catch(() => null);
    return r?.confirmed ? "confirmed" : "pending";
  }
  const rc = await rpc<{ status: string } | null>(a.chain, "eth_getTransactionReceipt", [a.hash]);
  if (!rc) return "pending";
  return rc.status === "0x1" ? "confirmed" : "failed";
}

let refreshing = false;
/** Re-check pending entries on-chain (bounded, safe to call often). */
export async function refreshActivity() {
  if (refreshing || typeof window === "undefined") return;
  refreshing = true;
  try {
    const list = read();
    const pending = list.filter((a) => a.status === "pending").slice(0, 10);
    if (!pending.length) return;
    let changed = false;
    await Promise.all(pending.map(async (a) => {
      try {
        const s = await statusOf(a);
        if (s !== a.status) { a.status = s; if (s === "confirmed") a.confirmedAt = Date.now(); changed = true; }
      } catch { /* try again next time */ }
    }));
    if (changed) write(list);
  } finally { refreshing = false; }
}

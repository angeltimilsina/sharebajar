import "server-only";
import { q } from "./db";
import { sha256 } from "./crypto";

/**
 * Append-only, hash-chained accounting ledger. Every entry commits to the
 * previous entry's hash, so any edit or deletion breaks verification.
 * Corrections are made with reversal entries, never by updating rows.
 */
export interface LedgerEntry { eventId: string | null; entryType: string; account: string; token: string; amount: string; usdValue: number | null; memo: string }

const GENESIS = "0".repeat(64);

export const entryHash = (prev: string, e: LedgerEntry, at: string) =>
  sha256(`${prev}|${e.eventId ?? ""}|${e.entryType}|${e.account}|${e.token}|${e.amount}|${e.usdValue ?? ""}|${e.memo}|${at}`);

export async function appendLedger(entries: LedgerEntry[]) {
  for (const e of entries) {
    const [last] = await q<{ hash: string }>("select hash from ledger order by seq desc limit 1");
    const prev = last?.hash ?? GENESIS;
    const at = new Date().toISOString();
    await q(
      "insert into ledger (event_id, entry_type, account, token, amount, usd_value, memo, prev_hash, hash, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [e.eventId, e.entryType, e.account, e.token, e.amount, e.usdValue, e.memo, prev, entryHash(prev, e, at), at],
    );
  }
}

export async function verifyLedger(): Promise<{ ok: boolean; entries: number; brokenAt: number | null }> {
  const rows = await q<{ seq: string; event_id: string | null; entry_type: string; account: string; token: string; amount: string; usd_value: string | null; memo: string; prev_hash: string; hash: string; created_at: string | Date }>(
    "select * from ledger order by seq",
  );
  let prev = GENESIS;
  for (const r of rows) {
    const e: LedgerEntry = { eventId: r.event_id, entryType: r.entry_type, account: r.account, token: r.token, amount: String(r.amount), usdValue: r.usd_value === null ? null : Number(r.usd_value), memo: r.memo };
    const at = new Date(r.created_at).toISOString();
    if (r.prev_hash !== prev || entryHash(prev, e, at) !== r.hash) return { ok: false, entries: rows.length, brokenAt: Number(r.seq) };
    prev = r.hash;
  }
  return { ok: true, entries: rows.length, brokenAt: null };
}

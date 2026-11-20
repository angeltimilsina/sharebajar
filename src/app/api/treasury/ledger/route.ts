import { NextResponse } from "next/server";
import { requireRole } from "@/lib/treasury/access";
import { handle } from "@/lib/treasury/http";
import { q } from "@/lib/treasury/db";
import { toCsv } from "@/lib/treasury/csv";
import { verifyLedger } from "@/lib/treasury/ledger";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("format") === "csv") {
    try {
      await requireRole(req, "viewer", "ledger.export");
      const rows = await q("select seq, created_at, entry_type, account, token, amount, usd_value, memo, event_id, prev_hash, hash from ledger order by seq");
      return new NextResponse(toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="sharebajar-ledger-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
    } catch (e) {
      return handle(async () => { throw e; });
    }
  }
  return handle(async () => {
    await requireRole(req, "viewer", "ledger.view");
    const [entries, integrity, balances] = await Promise.all([
      q("select * from ledger order by seq desc limit 300"),
      verifyLedger(),
      q<{ account: string; token: string; amount: string; usd: string }>("select account, token, sum(amount)::text as amount, coalesce(sum(usd_value),0)::text as usd from ledger where entry_type <> 'memo' group by account, token order by account"),
    ]);
    return { entries, integrity, balances };
  });
}

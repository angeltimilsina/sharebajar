import { NextResponse } from "next/server";
import { requireRole } from "@/lib/treasury/access";
import { handle } from "@/lib/treasury/http";
import { q } from "@/lib/treasury/db";
import { toCsv } from "@/lib/treasury/csv";
import { audit } from "@/lib/treasury/audit";

/** Revenue / transfer records. ?format=csv for accounting export. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("format") === "csv") {
    try {
      const actor = await requireRole(req, "viewer", "revenue.export");
      const rows = await q(`select chain, tx_hash, log_index, fee_recipient, token, token_symbol, amount, gross_amount, provider_share, direction, source, provider, is_revenue, status, confirmations, block_number, block_time, usd_price, usd_value, price_source, expected_amount, reconciliation, environment, is_test, treasury_id, intent_id
        from revenue_events order by block_time`);
      await audit({ actor: actor.address, role: actor.role, action: "revenue.export", outcome: "ok", details: { rows: rows.length } });
      return new NextResponse(toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="sharebajar-revenue-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
    } catch (e) {
      return handle(async () => { throw e; });
    }
  }
  return handle(async () => {
    await requireRole(req, "viewer", "revenue.list");
    const only = url.searchParams.get("filter");
    const where = only === "revenue" ? "where is_revenue" : only === "pending" ? "where status='pending'" : only === "issues" ? "where reconciliation in ('under','over','unexpected') or status in ('orphaned','reverted')" : "";
    const rows = await q(`select * from revenue_events ${where} order by block_time desc nulls last limit 500`);
    const intents = await q("select * from swap_intents order by created_at desc limit 200");
    const expenses = await q("select * from expenses order by block_time desc limit 200");
    return { events: rows, intents, expenses };
  });
}

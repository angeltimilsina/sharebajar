import { requireRole } from "@/lib/treasury/access";
import { handle } from "@/lib/treasury/http";
import { q } from "@/lib/treasury/db";
import { listTreasuries } from "@/lib/treasury/store";

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const REV = "is_revenue and status='confirmed' and direction='in' and environment='mainnet'";

export async function GET(req: Request) {
  return handle(async () => {
    await requireRole(req, "viewer", "dashboard.view");
    const [periods] = await q<Record<string, string>>(`
      select
        coalesce(sum(usd_value) filter (where block_time >= date_trunc('day', now())), 0)::text as today,
        coalesce(sum(usd_value) filter (where block_time >= now() - interval '7 days'), 0)::text as week,
        coalesce(sum(usd_value) filter (where block_time >= now() - interval '30 days'), 0)::text as month,
        coalesce(sum(usd_value), 0)::text as all_time,
        coalesce(sum(gross_amount * usd_price), 0)::text as gross_all,
        coalesce(sum(provider_share * usd_price), 0)::text as provider_share_all,
        count(*)::text as events
      from revenue_events where ${REV} and not is_test`);
    const group = (col: string) => q<{ k: string; usd: string; n: string }>(`select ${col} as k, coalesce(sum(usd_value),0)::text as usd, count(*)::text as n from revenue_events where ${REV} and not is_test group by ${col} order by sum(usd_value) desc nulls last`);
    const [byChain, byToken, byProvider, bySource] = await Promise.all([group("chain"), group("coalesce(token_symbol, token)"), group("coalesce(provider,'unknown')"), group("source")]);
    const daily = await q<{ day: string | Date; chain: string; usd: string }>(`
      select date_trunc('day', block_time) as day, chain, coalesce(sum(usd_value),0)::text as usd from revenue_events
      where ${REV} and not is_test and block_time >= now() - interval '30 days' group by 1, 2 order by 1`);
    const [pending] = await q<{ n: string; usd: string }>("select count(*)::text as n, coalesce(sum(usd_value),0)::text as usd from revenue_events where is_revenue and status='pending'");
    const [tests] = await q<{ n: string; usd: string }>(`select count(*)::text as n, coalesce(sum(usd_value),0)::text as usd from revenue_events where ${REV} and is_test`);
    const [expenses] = await q<{ usd: string; n: string }>("select coalesce(sum(usd_value),0)::text as usd, count(*)::text as n from expenses where block_time >= now() - interval '30 days'");
    const recon = await q<{ reconciliation: string; n: string }>("select reconciliation, count(*)::text as n from revenue_events where is_revenue group by reconciliation");
    const intentIssues = await q("select id, chain, provider, tx_hash, status, status_detail, expected_fee, fee_token, is_test, created_at from swap_intents where status in ('fee_missing','failed','dropped') order by created_at desc limit 20");
    const intentStats = await q<{ status: string; n: string }>("select status, count(*)::text as n from swap_intents group by status");
    const recent = await q(`select id, chain, tx_hash, fee_recipient, token, token_symbol, amount, gross_amount, provider_share, usd_value, usd_price, price_source, source, provider, is_revenue, status, confirmations, block_time, reconciliation, expected_amount, is_test, direction, treasury_id, environment
      from revenue_events order by block_time desc nulls last limit 60`);
    const [alerts] = await q<{ n: string }>("select count(*)::text as n from alerts where acknowledged_at is null and severity <> 'info'");
    const [lastRun] = await q<{ at: string | Date; outcome: string; details: string }>("select at, outcome, details from audit_log where action='indexer.run' order by id desc limit 1");
    const treasuries = (await listTreasuries()).map((t) => ({ id: t.id, label: t.label, chain: t.chain, address: t.address, kind: t.kind, status: t.status, environment: t.environment, integrityOk: t.integrityOk, feeBps: t.feeConfig?.feeBps ?? null, mode: t.feeConfig?.mode ?? null }));
    const net = num(periods.all_time);
    return {
      generatedAt: Date.now(),
      revenue: { today: num(periods.today), week: num(periods.week), month: num(periods.month), allTime: net, grossAllTime: num(periods.gross_all), providerShareAllTime: num(periods.provider_share_all), netAfterExpenses30d: num(periods.month) - num(expenses?.usd), events: num(periods.events) },
      launchpad: { usd: num(bySource.find((s) => s.k === "launchpad_fee")?.usd), live: false, note: "Launchpad fee collection is not live yet; token launches are not available." },
      byChain: byChain.map((r) => ({ key: r.k, usd: num(r.usd), count: num(r.n) })),
      byToken: byToken.map((r) => ({ key: r.k, usd: num(r.usd), count: num(r.n) })),
      byProvider: byProvider.map((r) => ({ key: r.k, usd: num(r.usd), count: num(r.n) })),
      bySource: bySource.map((r) => ({ key: r.k, usd: num(r.usd), count: num(r.n) })),
      daily: daily.map((d) => ({ day: new Date(d.day).toISOString().slice(0, 10), chain: d.chain, usd: num(d.usd) })),
      pending: { count: num(pending?.n), usd: num(pending?.usd) },
      test: { count: num(tests?.n), usd: num(tests?.usd) },
      expenses30d: { usd: num(expenses?.usd), count: num(expenses?.n) },
      reconciliation: Object.fromEntries(recon.map((r) => [r.reconciliation ?? "unknown", num(r.n)])),
      intents: Object.fromEntries(intentStats.map((r) => [r.status, num(r.n)])),
      intentIssues,
      recent,
      openAlerts: num(alerts?.n),
      lastIndexerRun: lastRun ? { at: new Date(lastRun.at).toISOString(), outcome: lastRun.outcome, details: JSON.parse(lastRun.details ?? "{}") } : null,
      treasuries,
    };
  });
}

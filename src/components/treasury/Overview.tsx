"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
import { treasuryChain as getChain } from "@/lib/treasury/chainInfo";
import { formatTime, shortAddress, timeAgo } from "@/lib/format";
import { Badge, Button, Card, CardHeader, Notice, Stat } from "../ui/primitives";
import { DataStatus } from "../ui/DataStatus";
import { api, can, fmtUsd, STATUS_TONE, type Me } from "./client";
import { BreakdownBars, RevenueChart } from "./RevenueChart";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Dash { generatedAt: number; revenue: any; launchpad: any; byChain: any[]; byToken: any[]; byProvider: any[]; bySource: any[]; daily: any[]; pending: any; test: any; expenses30d: any; reconciliation: Record<string, number>; intents: Record<string, number>; intentIssues: any[]; recent: any[]; openAlerts: number; lastIndexerRun: any; treasuries: any[] }

export function txUrl(chain: string, hash: string) { return `${getChain(chain)?.explorer.tx ?? "#"}${hash}`; }

export function Overview({ me }: { me: Me }) {
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [balances, setBalances] = useState<{ total: number; at: number | null }>({ total: 0, at: null });
  const load = useCallback(() => api<Dash>("/api/treasury/dashboard").then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (!d) return;
    let alive = true;
    Promise.allSettled(d.treasuries.map((t) => api<{ totalUsd: number }>(`/api/treasury/treasuries/${t.id}/balances`))).then((rs) => {
      if (alive) setBalances({ total: rs.reduce((s, r) => s + (r.status === "fulfilled" ? r.value.totalUsd : 0), 0), at: Date.now() });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.treasuries.length]);

  const runIndexer = async () => {
    setRunning(true);
    try { await api("/api/treasury/index", { method: "POST" }); await load(); } catch (e) { setErr((e as Error).message); } finally { setRunning(false); }
  };

  if (err && !d) return <Notice tone="down">{err}</Notice>;
  if (!d) return <div className="text-sm text-muted py-10 text-center">Loading dashboard…</div>;
  const r = d.revenue;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <DataStatus fetchedAt={d.generatedAt} expectedMs={15_000} source="treasury database" />
        {d.lastIndexerRun && <span>Last reconciliation {timeAgo(new Date(d.lastIndexerRun.at).getTime())} · {d.lastIndexerRun.details?.newEvents ?? 0} new · {d.lastIndexerRun.outcome}</span>}
        {d.openAlerts > 0 && <Badge tone="warn">{d.openAlerts} open alerts</Badge>}
        <div className="flex-1" />
        {can(me, "operator") && <Button size="sm" variant="subtle" onClick={runIndexer} disabled={running}><RefreshCw size={13} className={running ? "animate-spin" : ""} /> Run reconciliation</Button>}
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        {[
          ["Treasury assets (est.)", fmtUsd(balances.total), balances.at ? `live balances · ${formatTime(balances.at)}` : "loading balances…"],
          ["Revenue today", fmtUsd(r.today), "net, confirmed"], ["Last 7 days", fmtUsd(r.week), "net, confirmed"], ["Last 30 days", fmtUsd(r.month), `after expenses ${fmtUsd(r.netAfterExpenses30d)}`],
          ["Pending", fmtUsd(d.pending.usd), `${d.pending.count} awaiting confirmations`], ["Test revenue", fmtUsd(d.test.usd), `${d.test.count} test swap fees (excluded)`],
        ].map(([k, v, s]) => <Card key={k} className="p-4"><Stat label={k} value={<span className="text-xl">{v}</span>} sub={<span className="text-faint">{s}</span>} /></Card>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-4"><div className="text-sm font-semibold mb-3">Daily net fee revenue by network (30 days)</div><RevenueChart daily={d.daily} /></Card>
        <Card className="p-4 space-y-3">
          <div className="text-sm font-semibold">Gross vs net (all time)</div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="Gross fees charged" value={fmtUsd(r.grossAllTime)} />
            <Stat label="Provider share" value={fmtUsd(r.providerShareAllTime)} sub={<span className="text-faint">Jupiter referral 20%</span>} />
            <Stat label="Net received" value={fmtUsd(r.allTime)} />
          </div>
          <div className="text-sm font-semibold pt-2">Token launch revenue</div>
          <div className="text-xs text-muted">{fmtUsd(d.launchpad.usd)} · {d.launchpad.note}</div>
          <div className="text-sm font-semibold pt-2">Reconciliation</div>
          <div className="flex flex-wrap gap-1.5">{Object.entries(d.reconciliation).map(([k, n]) => <Badge key={k} tone={STATUS_TONE[k] ?? "neutral"}>{k.replace("_", " ")} · {n}</Badge>)}{!Object.keys(d.reconciliation).length && <span className="text-xs text-muted">No fee events yet.</span>}</div>
          <div className="text-sm font-semibold pt-2">Swap intents</div>
          <div className="flex flex-wrap gap-1.5">{Object.entries(d.intents).map(([k, n]) => <Badge key={k} tone={STATUS_TONE[k] ?? "neutral"}>{k.replace("_", " ")} · {n}</Badge>)}{!Object.keys(d.intents).length && <span className="text-xs text-muted">No reported swaps yet.</span>}</div>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4"><div className="text-sm font-semibold mb-3">By network</div><BreakdownBars rows={d.byChain} label={(k) => getChain(k)?.name ?? k} /></Card>
        <Card className="p-4"><div className="text-sm font-semibold mb-3">By token</div><BreakdownBars rows={d.byToken} label={(k) => k} /></Card>
        <Card className="p-4"><div className="text-sm font-semibold mb-3">By swap provider</div><BreakdownBars rows={d.byProvider} label={(k) => (k === "jupiter" ? "Jupiter Swap V2" : k === "0x" ? "0x Swap API" : k)} /></Card>
      </div>
      {d.intentIssues.length > 0 && (
        <Card>
          <CardHeader title="Needs attention" sub="Swaps that failed, were dropped, or succeeded without the expected fee" />
          <IntentTable rows={d.intentIssues} />
        </Card>
      )}
      <Card>
        <CardHeader title="Recent treasury activity" sub="Every on-chain balance change at monitored accounts — revenue and transfers are classified separately" />
        <EventTable rows={d.recent} />
      </Card>
    </div>
  );
}

export function EventTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <div className="px-4 pb-6 text-xs text-muted">No activity indexed yet. Register a treasury and run reconciliation.</div>;
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full text-xs min-w-[1100px]">
        <thead className="text-faint border-y border-line"><tr>{["Time", "Network", "Transaction", "Recipient", "Token", "Amount", "USD", "Type", "Status", "Reconciliation"].map((h) => <th key={h} className="text-left font-normal px-3 py-2">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-line/60">
              <td className="px-3 py-2 whitespace-nowrap">{e.block_time ? new Date(e.block_time).toLocaleString() : "—"}</td>
              <td className="px-3">{getChain(e.chain)?.name ?? e.chain}{e.is_test && <Badge tone="warn" className="ml-1">TEST</Badge>}{e.environment !== "mainnet" && <Badge tone="info" className="ml-1">{e.environment}</Badge>}</td>
              <td className="px-3 num"><a className="hover:text-brand inline-flex items-center gap-1" href={txUrl(e.chain, e.tx_hash)} target="_blank" rel="noopener noreferrer">{shortAddress(e.tx_hash, 6, 4)}<ExternalLink size={10} /></a></td>
              <td className="px-3 num">{shortAddress(e.fee_recipient, 4, 4)}</td>
              <td className="px-3" title={e.token}>{e.token_symbol ?? shortAddress(e.token)}</td>
              <td className={`px-3 num ${e.direction === "out" ? "text-down" : ""}`}>{e.direction === "out" ? "−" : ""}{e.amount}{Number(e.provider_share) > 0 && <span className="text-faint"> (gross {e.gross_amount})</span>}</td>
              <td className="px-3 num" title={e.price_source}>{fmtUsd(e.usd_value === null ? null : Number(e.usd_value))}</td>
              <td className="px-3"><Badge tone={e.is_revenue ? "brand" : "neutral"}>{String(e.source).replace("_", " ")}</Badge></td>
              <td className="px-3"><Badge tone={STATUS_TONE[e.status] ?? "neutral"}>{e.status}{e.status === "pending" ? ` · ${e.confirmations}` : ""}</Badge></td>
              <td className="px-3"><Badge tone={STATUS_TONE[e.reconciliation] ?? "neutral"}>{String(e.reconciliation).replace("_", " ")}</Badge>{e.expected_amount && <span className="text-faint ml-1">exp {e.expected_amount}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IntentTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full text-xs min-w-[860px]">
        <thead className="text-faint border-y border-line"><tr>{["Reported", "Network", "Provider", "Transaction", "Expected fee", "Status", "Detail"].map((h) => <th key={h} className="text-left font-normal px-3 py-2">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-b border-line/60">
              <td className="px-3 py-2 whitespace-nowrap">{new Date(i.created_at).toLocaleString()}</td>
              <td className="px-3">{getChain(i.chain)?.name ?? i.chain}{i.is_test && <Badge tone="warn" className="ml-1">TEST</Badge>}</td>
              <td className="px-3">{i.provider}</td>
              <td className="px-3 num">{i.tx_hash ? <a className="hover:text-brand" href={txUrl(i.chain, i.tx_hash)} target="_blank" rel="noopener noreferrer">{shortAddress(i.tx_hash, 6, 4)}</a> : "—"}</td>
              <td className="px-3 num">{i.expected_fee ?? "—"}</td>
              <td className="px-3"><Badge tone={STATUS_TONE[i.status] ?? "neutral"}>{String(i.status).replace("_", " ")}</Badge></td>
              <td className="px-3 text-muted">{i.status_detail ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { Download, ShieldCheck, ShieldAlert } from "lucide-react";
import { Badge, Card, CardHeader, Notice, Tabs } from "../ui/primitives";
import { api, fmtUsd } from "./client";
import { EventTable, IntentTable } from "./Overview";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function Records() {
  const [tab, setTab] = useState<"events" | "intents" | "ledger">("events");
  const [filter, setFilter] = useState<"all" | "revenue" | "pending" | "issues">("all");
  const [data, setData] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<any>(`/api/treasury/revenue${filter === "all" ? "" : `?filter=${filter}`}`).then(setData).catch((e) => setErr(e.message)); }, [filter]);
  useEffect(() => { if (tab === "ledger") api<any>("/api/treasury/ledger").then(setLedger).catch((e) => setErr(e.message)); }, [tab]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs size="sm" tabs={[{ id: "events", label: "On-chain records" }, { id: "intents", label: "Swap intents" }, { id: "ledger", label: "Accounting ledger" }]} value={tab} onChange={setTab} />
        <div className="flex-1" />
        <a href="/api/treasury/revenue?format=csv" className="text-xs inline-flex items-center gap-1 text-brand"><Download size={13} /> Revenue CSV</a>
        <a href="/api/treasury/ledger?format=csv" className="text-xs inline-flex items-center gap-1 text-brand"><Download size={13} /> Ledger CSV</a>
      </div>
      {err && <Notice tone="down">{err}</Notice>}
      {tab === "events" && (
        <Card>
          <CardHeader title="Revenue & transfer records" sub="Chain · tx hash · recipient · token · amount · time · confirmation status for every record" action={<Tabs size="sm" tabs={[{ id: "all", label: "All" }, { id: "revenue", label: "Revenue" }, { id: "pending", label: "Pending" }, { id: "issues", label: "Issues" }]} value={filter} onChange={setFilter} />} />
          {data ? <EventTable rows={data.events} /> : <p className="px-4 pb-4 text-xs text-muted">Loading…</p>}
        </Card>
      )}
      {tab === "intents" && (
        <Card>
          <CardHeader title="Swap intents" sub="Fees Bajar expected from swaps routed through the app, and what the chain says happened" />
          {data ? (data.intents.length ? <IntentTable rows={data.intents} /> : <p className="px-4 pb-4 text-xs text-muted">No swaps reported yet.</p>) : <p className="px-4 pb-4 text-xs text-muted">Loading…</p>}
        </Card>
      )}
      {tab === "ledger" && ledger && (
        <div className="space-y-4">
          <Card className="p-4 flex items-center gap-3">
            {ledger.integrity.ok ? <ShieldCheck className="text-up" /> : <ShieldAlert className="text-down" />}
            <div className="text-sm">{ledger.integrity.ok ? <>Hash chain verified across <b>{ledger.integrity.entries}</b> entries. No entry has been altered or removed.</> : <>Hash chain broken at entry <b>#{ledger.integrity.brokenAt}</b> — the ledger was modified outside the application.</>}</div>
          </Card>
          <Card>
            <CardHeader title="Account balances" sub="Sum of ledger entries (memo entries excluded)" />
            <table className="w-full text-xs num mb-3"><thead className="text-faint"><tr><th className="text-left font-normal px-4">Account</th><th className="text-left font-normal">Token</th><th className="text-right font-normal">Amount</th><th className="text-right font-normal px-4">USD (at receipt)</th></tr></thead>
              <tbody>{ledger.balances.map((b: any) => <tr key={b.account + b.token} className="border-t border-line/60"><td className="px-4 py-1">{b.account}</td><td>{b.token.slice(0, 8)}…</td><td className="text-right">{b.amount}</td><td className="text-right px-4">{fmtUsd(Number(b.usd))}</td></tr>)}</tbody></table>
          </Card>
          <Card>
            <CardHeader title="Entries" sub="Append-only · corrections are reversal entries" />
            <div className="overflow-x-auto scroll-thin"><table className="w-full text-xs num min-w-[900px] mb-3"><thead className="text-faint border-y border-line"><tr>{["#", "Time", "Type", "Account", "Amount", "USD", "Memo", "Hash"].map((h) => <th key={h} className="text-left font-normal px-3 py-2">{h}</th>)}</tr></thead>
              <tbody>{ledger.entries.map((e: any) => <tr key={e.seq} className="border-b border-line/60"><td className="px-3 py-1">{e.seq}</td><td className="px-3">{new Date(e.created_at).toLocaleString()}</td><td className="px-3"><Badge tone={e.entry_type === "reversal" ? "down" : e.entry_type === "credit" ? "brand" : "neutral"}>{e.entry_type}</Badge></td><td className="px-3">{e.account}</td><td className="px-3">{e.amount}</td><td className="px-3">{fmtUsd(e.usd_value === null ? null : Number(e.usd_value))}</td><td className="px-3 text-muted">{e.memo}</td><td className="px-3 text-faint">{e.hash.slice(0, 10)}…</td></tr>)}</tbody></table></div>
          </Card>
        </div>
      )}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { shortAddress } from "@/lib/format";
import { Badge, Button, Card, CardHeader, Notice } from "../ui/primitives";
import { api, can, STATUS_TONE, usePropose, useSigner, type Me } from "./client";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function Governance({ me }: { me: Me }) {
  const [changes, setChanges] = useState<any[]>([]);
  const [audit, setAudit] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  const { sign } = useSigner();
  const propose = usePropose();
  const [newAdmin, setNewAdmin] = useState({ address: "", role: "viewer", label: "" });
  const load = useCallback(() => {
    api<any>("/api/treasury/changes").then((r) => setChanges(r.changes)).catch((e) => setMsg({ tone: "down", text: e.message }));
    api<any>("/api/treasury/audit").then(setAudit).catch(() => {});
    api<any>("/api/treasury/alerts").then((r) => setAlerts(r.alerts)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (k: string, fn: () => Promise<string>) => { setBusy(k); setMsg(null); try { setMsg({ tone: "info", text: await fn() }); load(); } catch (e) { setMsg({ tone: "down", text: (e as Error).message }); } finally { setBusy(null); } };

  return (
    <div className="space-y-4">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card>
        <CardHeader title="Change requests" sub={`Sensitive changes need ${me.config.requiredApprovals} wallet signature(s) from different admins (requester included)`} />
        {!changes.length ? <p className="px-4 pb-4 text-xs text-muted">No change requests.</p> : (
          <ul className="divide-y divide-line/60">
            {changes.map((c) => (
              <li key={c.id} className="px-4 py-3 text-xs space-y-1">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Badge><span className="font-semibold text-sm">{c.action.replace("_", " ")}</span><span className="text-faint num">{c.id}</span><span className="flex-1" /><span className="text-muted">{new Date(c.createdAt).toLocaleString()}</span></div>
                <div className="text-muted">Requested by <span className="num">{shortAddress(c.requestedBy, 6, 4)}</span>{c.approvals.length > 0 && <> · approved by {c.approvals.map((a: any) => shortAddress(a.approver, 6, 4)).join(", ")}</>} · payload SHA-256 <span className="num">{c.payloadHash.slice(0, 16)}…</span></div>
                <pre className="bg-surface-2 rounded-lg p-2 overflow-x-auto text-[11px]">{JSON.stringify(c.payload, null, 2)}</pre>
                {c.reason && <div className="text-down">{c.reason}</div>}
                {c.status === "pending" && can(me, "admin") && (
                  <div className="flex gap-2">
                    {c.requestedBy !== me.actor!.address && !c.approvals.some((a: any) => a.approver === me.actor!.address) && <Button size="sm" disabled={!!busy} onClick={() => run(c.id, async () => {
                      const m = await api<{ message: string }>(`/api/treasury/changes/${c.id}`, { body: { op: "message" } });
                      const s = await sign(m.message);
                      const r = await api<any>(`/api/treasury/changes/${c.id}`, { body: { op: "approve", signature: s.signature } });
                      return r.change.status === "applied" ? "Approved and applied." : "Approval recorded.";
                    })}>{busy === c.id ? <Loader2 size={13} className="animate-spin" /> : null} Review & approve (sign)</Button>}
                    <Button size="sm" variant="subtle" disabled={!!busy} onClick={() => { const reason = prompt("Reason for rejection?"); if (reason) run(c.id + "r", async () => { await api(`/api/treasury/changes/${c.id}`, { body: { op: "reject", reason } }); return "Rejected."; }); }}>Reject</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Administrators" sub="Bootstrap owners come from TREASURY_OWNERS; others are granted by signed change requests" />
          <ul className="px-4 pb-3 text-xs space-y-1">{audit?.admins.map((a: any) => <li key={a.address} className="flex items-center gap-2"><Badge tone="brand">{a.role}</Badge><span className="num">{a.address}</span><span className="text-muted">{a.label}</span>{can(me, "owner") && <button className="ml-auto text-down" onClick={() => run("rv" + a.address, async () => { const r = await propose("revoke_role", { address: a.address }); return r.change.status === "applied" ? "Revoked." : "Revocation requested."; })}>revoke</button>}</li>)}{!audit?.admins.length && <li className="text-muted">Only env-configured owners.</li>}</ul>
          {can(me, "owner") && (
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              <input value={newAdmin.address} onChange={(e) => setNewAdmin({ ...newAdmin, address: e.target.value.trim() })} placeholder="Wallet address" className="flex-1 min-w-[200px] h-8 rounded-lg bg-surface-2 border border-line px-2 text-xs num" />
              <select value={newAdmin.role} onChange={(e) => setNewAdmin({ ...newAdmin, role: e.target.value })} className="h-8 rounded-lg bg-surface-2 border border-line px-2 text-xs">{["viewer", "operator", "admin", "owner"].map((r) => <option key={r}>{r}</option>)}</select>
              <input value={newAdmin.label} onChange={(e) => setNewAdmin({ ...newAdmin, label: e.target.value })} placeholder="Label" className="w-28 h-8 rounded-lg bg-surface-2 border border-line px-2 text-xs" />
              <Button size="sm" disabled={!newAdmin.address || !!busy} onClick={() => run("grant", async () => { const r = await propose("grant_role", newAdmin); return r.change.status === "applied" ? "Role granted." : `Requested (${r.change.id}).`; })}>Grant</Button>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Alerts" sub="Also sent to TREASURY_ALERT_WEBHOOK_URL when configured" />
          <ul className="px-4 pb-3 text-xs space-y-1.5 max-h-80 overflow-y-auto scroll-thin">
            {alerts.map((a) => <li key={a.id} className={`flex gap-2 ${a.acknowledged_at ? "opacity-50" : ""}`}><Badge tone={a.severity === "critical" ? "down" : a.severity === "warning" ? "warn" : "neutral"}>{a.severity}</Badge><span className="flex-1">{a.message}<span className="text-faint"> · {new Date(a.at).toLocaleString()}</span></span>{!a.acknowledged_at && can(me, "operator") && a.severity !== "info" && <button className="text-brand" onClick={() => run("ack" + a.id, async () => { await api("/api/treasury/alerts", { body: { id: Number(a.id) } }); return "Acknowledged."; })}>ack</button>}</li>)}
            {!alerts.length && <li className="text-muted">No alerts.</li>}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Audit log" sub="Every treasury action and denied attempt" />
        <div className="overflow-x-auto scroll-thin"><table className="w-full text-xs min-w-[800px] mb-3"><thead className="text-faint border-y border-line"><tr>{["Time", "Actor", "Role", "Action", "Target", "Outcome", "IP"].map((h) => <th key={h} className="text-left font-normal px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>{audit?.entries.map((e: any) => <tr key={e.id} className="border-b border-line/60"><td className="px-3 py-1 whitespace-nowrap">{new Date(e.at).toLocaleString()}</td><td className="px-3 num">{e.actor ? shortAddress(e.actor, 6, 4) : "—"}</td><td className="px-3">{e.role ?? ""}</td><td className="px-3">{e.action}</td><td className="px-3 num">{e.target ?? ""}</td><td className="px-3"><Badge tone={e.outcome === "ok" ? "up" : e.outcome === "denied" ? "down" : e.outcome === "pending" ? "warn" : "neutral"}>{e.outcome}</Badge></td><td className="px-3 text-faint">{e.ip ?? ""}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { Card, CardHeader, Notice, Stat } from "../ui/primitives";
import { api, fmtUsd } from "./client";

interface Totals { orders: number; gmv: number; bajarFees: number; commissions: number; refunds: number; merchantSettlement: number; failed: number; net: number }
interface Data { live: Totals; sandbox: Totals; feeBps: number; commissionBps: number; provider: string | null }

/** BAJAR Agents commerce revenue. Customer payments, merchant settlement and BAJAR fees are reported separately; sandbox never mixes with live. */
export function Commerce() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Data>("/api/treasury/commerce").then(setD).catch((e) => setErr((e as Error).message)); }, []);
  if (err) return <Notice tone="down">{err}</Notice>;
  if (!d) return <div className="py-10 text-center text-sm text-muted">Loading…</div>;
  const block = (title: string, t: Totals, testid: string) => (
    <Card data-testid={testid}>
      <CardHeader title={title} />
      <div className="px-4 sm:px-5 pb-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="GMV (customer payments)" value={fmtUsd(t.gmv)} sub={`${t.orders} orders`} />
        <Stat label="Merchant settlement" value={fmtUsd(t.merchantSettlement)} />
        <Stat label="BAJAR Pay fees" value={fmtUsd(t.bajarFees)} />
        <Stat label="Merchant commissions" value={fmtUsd(t.commissions)} />
        <Stat label="Refunds" value={fmtUsd(t.refunds)} />
        <Stat label="Merchant confirmation failures" value={String(t.failed)} />
        <Stat label="Net BAJAR revenue" value={fmtUsd(t.net)} sub="fees + commissions, excluding refunded orders" />
      </div>
    </Card>
  );
  return (
    <div className="space-y-4" data-testid="commerce-revenue">
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><ShoppingBag size={16} className="text-ai" />Commerce</span>} sub={`BAJAR Pay fee ${(d.feeBps / 100).toFixed(2)}% (disclosed to customers, waived for Plus) · merchant commission ${(d.commissionBps / 100).toFixed(2)}% (paid by merchants).`} />
        <div className="px-4 sm:px-5 pb-4 text-[13px] text-muted">{d.provider ? `Live payment provider: ${d.provider}.` : "No live payment provider is configured — every order so far is a sandbox test. Real merchants use their own checkout."}</div>
      </Card>
      {block("Live", d.live, "commerce-live")}
      {block("Sandbox (test orders — no money moved)", d.sandbox, "commerce-sandbox")}
    </div>
  );
}

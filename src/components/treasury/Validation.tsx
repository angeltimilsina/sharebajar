"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { getChain } from "@/lib/chains";
import { Badge, Card, Notice } from "../ui/primitives";
import { api, type Me } from "./client";
import { useTreasuries } from "./Treasuries";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Production readiness checklist. Items are derived from real data (registered
 * treasuries, confirmed on-chain test fees, reconciliation and failure records),
 * never self-reported.
 */
export function Validation({ me }: { me: Me }) {
  const { list } = useTreasuries();
  const [rev, setRev] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  useEffect(() => { api<any>("/api/treasury/revenue").then(setRev).catch(() => {}); api<any>("/api/treasury/audit").then(setAudit).catch(() => {}); }, []);
  const ts = list ?? [];
  const events = rev?.events ?? [];
  const intents = rev?.intents ?? [];
  const tests = events.filter((e: any) => e.is_test && e.is_revenue);
  const confirmedTests = tests.filter((e: any) => e.status === "confirmed");
  const matched = confirmedTests.filter((e: any) => e.reconciliation === "matched");
  const failedOrReverted = intents.filter((i: any) => ["failed", "dropped"].includes(i.status));
  const ineligible = intents.filter((i: any) => i.status === "no_fee");
  const denied = (audit?.entries ?? []).filter((e: any) => e.outcome === "denied");
  const tamperGuard = ts.length > 0 && ts.every((t) => t.integrityOk);
  const items: { title: string; ok: boolean; detail: React.ReactNode }[] = [
    { title: "1. Register test treasury addresses", ok: ts.some((t) => t.ownership), detail: `${ts.length} registered · ${ts.filter((t) => t.ownership).length} ownership-verified` },
    { title: "2. Execute small, authorized test swaps", ok: intents.some((i: any) => i.is_test), detail: <>Put a treasury in testing mode, then swap a small amount from an admin wallet on <Link className="text-brand" href="/trade">Trade</Link>. Reported: {intents.filter((i: any) => i.is_test).length}</> },
    { title: "3. Verify fees reached the correct receiving accounts", ok: confirmedTests.length > 0, detail: `${confirmedTests.length} confirmed test fee(s) detected at registered fee accounts by the indexer` },
    { title: "4. Confirm the amounts in block explorers", ok: confirmedTests.length > 0, detail: confirmedTests.length ? <span className="flex flex-wrap gap-2">{confirmedTests.slice(0, 5).map((e: any) => <a key={e.id} className="text-brand inline-flex items-center gap-0.5 num" href={`${getChain(e.chain)?.explorer.tx}${e.tx_hash}`} target="_blank" rel="noopener noreferrer">{e.amount} {e.token_symbol}<ExternalLink size={10} /></a>)}</span> : "Links appear after the first confirmed test fee." },
    { title: "5. Verify dashboard reconciliation", ok: confirmedTests.length > 0 && matched.length === confirmedTests.length, detail: `${matched.length}/${confirmedTests.length} test fees matched the expected amount` },
    { title: "6. Test failed, reverted and fee-ineligible transactions", ok: failedOrReverted.length > 0 && ineligible.length > 0, detail: `${failedOrReverted.length} failed/dropped swap(s) recorded with no revenue · ${ineligible.length} fee-ineligible swap(s) recorded as “no fee”. Try a swap into a non-fee token and one that fails (e.g. very low slippage).` },
    { title: "7. Test unauthorized access and address-modification protections", ok: denied.length > 0 && tamperGuard, detail: `${denied.length} denied access attempt(s) in the audit log · integrity seals ${tamperGuard ? "valid on all treasuries" : "not yet verified"}. Automated tests cover sealed-record tampering and role enforcement.` },
  ];
  return (
    <div className="space-y-4 max-w-4xl">
      <Notice title="Real chains only">All checks use mainnet activity labelled as test (admin wallets, treasury in testing mode). Jupiter and 0x swap fees are not available on testnets; testnet treasuries exist for indexer checks only. Simulations are labelled as simulations and never counted as revenue.</Notice>
      <Card className="p-4 space-y-3">
        {items.map((i) => (
          <div key={i.title} className="flex gap-3">
            {i.ok ? <CheckCircle2 size={18} className="text-up shrink-0 mt-0.5" /> : <Circle size={18} className="text-faint shrink-0 mt-0.5" />}
            <div><div className="text-sm font-medium">{i.title}</div><div className="text-xs text-muted">{i.detail}</div></div>
          </div>
        ))}
      </Card>
      <div className="flex gap-2 text-xs">{items.every((i) => i.ok) ? <Badge tone="up">Ready to activate revenue collection</Badge> : <Badge tone="warn">{items.filter((i) => !i.ok).length} item(s) remaining before production</Badge>}<span className="text-muted">Required approvals: {me.config.requiredApprovals}</span></div>
    </div>
  );
}

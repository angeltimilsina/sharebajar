"use client";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Card, CardHeader, Badge, Skeleton } from "../ui/primitives";
import { bajar } from "@/lib/bajar/session";
import { localActivity, explorerTx } from "@/lib/bajar/send";
import { timeAgo } from "@/lib/format";
import { getChain } from "@/lib/chains";

interface Item { network: string; hash: string; time: number | null; label: string; status: string; tone: "up" | "down" | "warn" | "neutral" }

export function ActivityPanel() {
  const a = bajar.accounts()!;
  const [items, setItems] = useState<Item[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    const errs: string[] = [];
    const local = localActivity();
    const labelFor = (h: string) => local.find((l) => l.hash === h)?.summary;
    Promise.all([
      fetch(`/api/wallet/btc?op=summary&address=${a.bitcoin.address}`).then((r) => r.json()).then((b) => (b.txs ?? []).map((t: { txid: string; time: number | null; confirmed: boolean; delta: number }): Item => ({ network: "bitcoin", hash: t.txid, time: t.time, label: labelFor(t.txid) ?? `${t.delta >= 0 ? "Received" : "Sent"} ${(Math.abs(t.delta) / 1e8).toFixed(8)} BTC`, status: t.confirmed ? "confirmed" : "pending", tone: t.confirmed ? "up" : "warn" }))).catch(() => { errs.push("Bitcoin"); return []; }),
      fetch(`/api/wallet/history?solana=${a.solana.address}`).then((r) => r.json()).then((b) => (b.solana ?? []).map((t: { signature: string; time: number | null; failed: boolean; status: string | null }): Item => ({ network: "solana", hash: t.signature, time: t.time, label: labelFor(t.signature) ?? "Solana transaction", status: t.failed ? "failed" : t.status ?? "processed", tone: t.failed ? "down" : "up" }))).catch(() => { errs.push("Solana"); return []; }),
    ]).then(([btc, sol]) => {
      const evm = local.filter((l) => l.network !== "bitcoin" && l.network !== "solana").map((l): Item => ({ network: l.network, hash: l.hash, time: l.at, label: l.summary, status: "sent from this device", tone: "neutral" }));
      setItems([...btc, ...sol, ...evm].sort((x, y) => (y.time ?? Infinity) - (x.time ?? Infinity)));
      setErrors(errs);
    });
  }, [a.bitcoin.address, a.solana.address]);
  return (
    <Card>
      <CardHeader title="Activity" sub={`Bitcoin and Solana history read from the networks. EVM: transactions sent from this device (full EVM history: open the explorer for ${a.evm.address.slice(0, 8)}…).`} />
      {errors.length > 0 && <p className="px-4 text-xs text-down">Could not load: {errors.join(", ")}</p>}
      <ul className="divide-y divide-line">
        {!items && Array.from({ length: 4 }, (_, i) => <li key={i} className="p-3"><Skeleton className="h-6" /></li>)}
        {items?.length === 0 && <li className="p-4 text-sm text-muted">No transactions yet.</li>}
        {items?.map((i) => (
          <li key={i.network + i.hash} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="text-[11px] text-muted w-16 shrink-0">{i.network === "bitcoin" ? "Bitcoin" : getChain(i.network)?.name ?? i.network}</span>
            <span className="flex-1 min-w-0 truncate">{i.label}</span>
            <Badge tone={i.tone}>{i.status}</Badge>
            <span className="text-[11px] text-faint w-16 text-right">{i.time ? timeAgo(i.time) : "pending"}</span>
            <a href={explorerTx(i.network, i.hash)} target="_blank" rel="noopener noreferrer" aria-label="Explorer"><ExternalLink size={12} className="text-muted" /></a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

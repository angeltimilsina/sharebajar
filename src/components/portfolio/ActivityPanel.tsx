"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import { Badge, Card, CardHeader } from "../ui/primitives";
import { activities, explorerUrl, refreshActivity, subscribeActivity, type Activity } from "@/lib/activity";
import { getChain } from "@/lib/chains";
import { timeAgo } from "@/lib/format";

let cache: Activity[] = [];
let cacheKey = "";
const snapshot = () => {
  const list = activities();
  const key = list.map((a) => `${a.id}:${a.status}`).join("|");
  if (key !== cacheKey) { cacheKey = key; cache = list; }
  return cache;
};
const EMPTY: Activity[] = [];

/**
 * Transactions started in Bajar (trades, swaps, sends, approvals) with their
 * live on-chain status. Pending entries are re-checked every few seconds.
 */
export function ActivityPanel({ wallet, limit = 20 }: { wallet?: string; limit?: number }) {
  const list = useSyncExternalStore(subscribeActivity, snapshot, () => EMPTY);
  const [now, setNow] = useState(Date.now());
  const shown = (wallet ? list.filter((a) => !a.wallet || a.wallet.toLowerCase() === wallet.toLowerCase()) : list).slice(0, limit);
  const pending = shown.some((a) => a.status === "pending");

  useEffect(() => {
    void refreshActivity();
    if (!pending) return;
    const t = setInterval(() => { void refreshActivity(); setNow(Date.now()); }, 6000);
    return () => clearInterval(t);
  }, [pending]);

  return (
    <Card data-testid="portfolio-activity">
      <CardHeader title="Activity" sub="Trades, swaps and transfers made in Bajar · status checked on-chain" action={pending ? <Badge tone="warn"><Loader2 size={10} className="animate-spin" /> Updating</Badge> : undefined} />
      {shown.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">No activity yet. When you trade or swap, it appears here with its live status.</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 sm:px-5 py-3 text-sm">
              <span className={`h-2 w-2 rounded-full shrink-0 ${a.status === "confirmed" ? "bg-up" : a.status === "failed" ? "bg-down" : "bg-warn pulse-dot"}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate">{a.summary}</div>
                <div className="text-[11px] text-muted">{a.chain === "bitcoin" ? "Bitcoin" : getChain(a.chain)?.name ?? a.chain} · {timeAgo(a.at, now)}{a.assetHref && <> · <Link href={a.assetHref} className="underline underline-offset-2">Open asset</Link></>}</div>
              </div>
              <Badge tone={a.status === "confirmed" ? "up" : a.status === "failed" ? "down" : "warn"}>{a.status === "confirmed" ? "Confirmed" : a.status === "failed" ? "Failed" : "Pending"}</Badge>
              <a href={explorerUrl(a.chain, a.hash)} target="_blank" rel="noopener noreferrer" aria-label="View on explorer" className="text-muted hover:text-fg"><ExternalLink size={13} /></a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

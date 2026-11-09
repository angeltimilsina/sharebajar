"use client";
import Link from "next/link";
import { Trash2, BellRing } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import { useAlerts, useWatchlist, watchKey } from "@/hooks/useWatchlist";
import { getChain } from "@/lib/chains";
import { formatPrice } from "@/lib/format";
import { Badge, Card, CardHeader } from "../ui/primitives";
import { ActivityPanel } from "./ActivityPanel";
import { PortfolioIntro } from "./PortfolioIntro";
import { PortfolioDashboard } from "./PortfolioDashboard";

export function Portfolio() {
  const { wallet } = useWallet();
  if (!wallet) {
    return (
      <div className="space-y-6">
        <PortfolioIntro />
        <div className="grid gap-4 lg:grid-cols-2">
          <div id="activity" className="scroll-mt-24"><ActivityPanel /></div>
          <WatchAndAlerts />
        </div>
      </div>
    );
  }
  return <PortfolioDashboard side={<WatchAndAlerts />} />;
}

function WatchAndAlerts() {
  const wl = useWatchlist();
  const al = useAlerts();
  return (
    <div className="space-y-4 text-left">
      <Card>
        <CardHeader title="Watchlist" sub={`${wl.items.length} saved on this device`} />
        <ul className="px-4 pb-4 space-y-1.5 text-sm">
          {wl.items.map((i) => (
            <li key={watchKey(i)} className="flex items-center gap-2">
              <Link href={i.kind === "coin" ? `/coin/${i.id}` : `/token/${i.chain}/${i.address}`} className="flex-1 hover:text-brand font-medium">{i.label}</Link>
              <span className="text-xs text-muted">{i.kind === "coin" ? "Listed coin" : getChain(i.chain)?.name}</span>
              <button onClick={() => wl.remove(watchKey(i))} aria-label={`Remove ${i.label}`} className="text-faint hover:text-down"><Trash2 size={13} /></button>
            </li>
          ))}
          {!wl.items.length && <li className="text-xs text-muted">Tap ☆ on any token to add it here.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Price alerts" icon={<BellRing size={14} className="text-brand" />} sub="Checked every 30s while Bajar is open" />
        <ul className="px-4 pb-4 space-y-1.5 text-sm">
          {al.alerts.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span className="flex-1">{a.label} <span className="text-muted text-xs">{a.condition} {formatPrice(a.price)}</span></span>
              {a.triggeredAt ? <Badge tone="up">Triggered</Badge> : <Badge>Active</Badge>}
              <button onClick={() => al.remove(a.id)} aria-label="Delete alert" className="text-faint hover:text-down"><Trash2 size={13} /></button>
            </li>
          ))}
          {!al.alerts.length && <li className="text-xs text-muted">Ask Bajar Intelligence to set an alert, e.g. “alert me if SOL drops below $80”.</li>}
        </ul>
      </Card>
    </div>
  );
}

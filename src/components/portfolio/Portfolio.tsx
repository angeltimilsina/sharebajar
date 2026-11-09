"use client";
import Link from "next/link";
import { Trash2, BellRing } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import { useAlerts, useWatchlist, watchKey } from "@/hooks/useWatchlist";
import { getChain } from "@/lib/chains";
import { formatPrice } from "@/lib/format";
import { useMemo } from "react";
import { Badge, Button, Card, CardHeader, Notice } from "../ui/primitives";
import { useBajar } from "../bajar/useBajar";
import { useProfile } from "@/hooks/useProfile";
import type { TrackedWallet } from "@/lib/wallets/registry";
import { ActivityPanel } from "./ActivityPanel";
import { PortfolioIntro } from "./PortfolioIntro";
import { PortfolioDashboard } from "./PortfolioDashboard";

/**
 * One wallet: Bajar Wallet (its Bitcoin, EVM and Solana accounts plus the
 * wallets connected to it with a connection token) or, without it, the
 * wallet connected in this browser.
 */
export function Portfolio() {
  const { wallet } = useWallet();
  const { hasVault, unlocked, accounts } = useBajar();
  const p = useProfile();
  const linkedToBajar = !!accounts && p.signedIn && p.address === accounts.solana.address;

  const wallets = useMemo<TrackedWallet[]>(() => {
    if (unlocked && accounts) {
      const own = [
        { id: `bitcoin:${accounts.bitcoin.address}`, address: accounts.bitcoin.address, chain: "bitcoin" as const, label: "Bajar Wallet", source: "bajar" as const, addedAt: 0 },
        { id: `evm:${accounts.evm.address.toLowerCase()}`, address: accounts.evm.address, chain: "evm" as const, label: "Bajar Wallet", source: "bajar" as const, addedAt: 0 },
        { id: `solana:${accounts.solana.address}`, address: accounts.solana.address, chain: "solana" as const, label: "Bajar Wallet", source: "bajar" as const, addedAt: 0 },
      ];
      const ownIds = new Set(own.map((w) => w.id));
      const connected = linkedToBajar ? (p.profile?.wallets ?? []).map((w) => ({ id: `${w.chainType}:${w.address}`, address: w.address, chain: w.chainType, label: w.label ?? (w.chainType === "evm" ? "EVM wallet" : "Solana wallet"), source: "linked" as const, verified: true, addedAt: 1 })).filter((w) => !ownIds.has(w.id)) : [];
      return [...own, ...connected];
    }
    if (wallet) return [{ id: `${wallet.chainType}:${wallet.chainType === "evm" ? wallet.address.toLowerCase() : wallet.address}`, address: wallet.address, chain: wallet.chainType, label: wallet.walletName, source: "connected" as const, addedAt: 0 }];
    return [];
  }, [unlocked, accounts, wallet, linkedToBajar, p.profile]);

  if (unlocked && accounts) {
    const n = wallets.filter((w) => w.source === "linked").length;
    return <PortfolioDashboard wallets={wallets} side={<WatchAndAlerts />} source={{ title: "Bajar Wallet", subtitle: n ? `${n} connected wallet${n === 1 ? "" : "s"}` : "Bitcoin · EVM · Solana", manageHref: "/wallet#connections", manageLabel: "Connect" }} />;
  }
  if (wallet) {
    return (
      <div className="space-y-4">
        <Notice title={hasVault ? "Unlock Bajar Wallet to see everything in one place" : "Bring this wallet into Bajar Wallet"}>
          {hasVault ? "Your Bajar Wallet and the wallets connected to it show here once it's unlocked." : "Create a Bajar Wallet, then connect this and your other wallets to it with a one-time connection token."} <Link href="/wallet" className="underline">Open Bajar Wallet</Link>
        </Notice>
        <PortfolioDashboard wallets={wallets} side={<WatchAndAlerts />} source={{ title: wallet.walletName, subtitle: "This wallet" }} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {hasVault && (
        <Card className="p-5 flex flex-wrap items-center gap-3" data-testid="portfolio-unlock">
          <span className="flex-1 min-w-0"><span className="block text-[16px] font-semibold">Unlock Bajar Wallet</span><span className="block text-[13px] text-muted">Your portfolio, connected wallets and activity are one unlock away.</span></span>
          <Link href="/wallet"><Button>Unlock</Button></Link>
        </Card>
      )}
      <PortfolioIntro />
      <div className="grid gap-4 lg:grid-cols-2">
        <div id="activity" className="scroll-mt-24"><ActivityPanel /></div>
        <WatchAndAlerts />
      </div>
    </div>
  );
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

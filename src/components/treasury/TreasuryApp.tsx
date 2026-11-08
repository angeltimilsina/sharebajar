"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, ShieldCheck, Wallet, AlertTriangle } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import { Badge, Button, Card, Notice, Tabs } from "../ui/primitives";
import { useMe } from "./client";
import { Overview } from "./Overview";
import { Setup } from "./Setup";
import { Treasuries } from "./Treasuries";
import { Operations } from "./Operations";
import { Records } from "./Records";
import { Governance } from "./Governance";
import { Validation } from "./Validation";

const TABS = [
  { id: "overview", label: "Dashboard" }, { id: "treasuries", label: "Treasuries" }, { id: "setup", label: "Setup wizard" },
  { id: "assets", label: "Assets & operations" }, { id: "records", label: "Revenue & ledger" }, { id: "validation", label: "Production validation" },
  { id: "governance", label: "Approvals & audit" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function TreasuryApp() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.id === sp.get("tab"))?.id ?? "overview") as Tab;
  const { me, error, reload } = useMe();
  const { wallet, openModal, signIn, session, error: walletErr } = useWallet();

  if (!me && !error) return <div className="py-20 text-center text-sm text-muted">Loading treasury…</div>;
  if (error) return <Notice tone="down" title="Treasury unavailable" className="my-10">{error}</Notice>;

  if (!me!.actor) {
    const signedInAs = session && wallet && session.address.toLowerCase() === wallet.address.toLowerCase();
    return (
      <Card className="max-w-xl mx-auto my-12 p-8 text-center">
        <Lock className="mx-auto text-brand" size={32} />
        <h1 className="text-xl font-semibold mt-3">Bajar Treasury</h1>
        <p className="text-sm text-muted mt-1">Private administration. Sign in with an authorized admin wallet. You will sign a message — no transaction, no fees.</p>
        <div className="mt-5 flex justify-center gap-2">
          {!wallet ? <Button onClick={openModal}><Wallet size={15} /> Connect wallet</Button>
            : !signedInAs ? <Button onClick={async () => { await signIn(); reload(); }}><ShieldCheck size={15} /> Sign in with wallet</Button>
            : <Notice tone="warn">{wallet.address} is signed in but is not an authorized treasury admin. This attempt has been logged.</Notice>}
        </div>
        {walletErr && <div className="text-xs text-down mt-3">{walletErr}</div>}
        {me!.config.ownersConfigured === 0 && <Notice tone="warn" className="mt-5 text-left" title="No owners configured">Set <code>TREASURY_OWNERS</code> (comma-separated admin wallet addresses) in the server environment to bootstrap access.</Notice>}
        <p className="text-[11px] text-faint mt-5">Bajar never asks for recovery phrases or private keys. Treasury keys stay in your wallets and multisigs.</p>
      </Card>
    );
  }

  const c = me!.config;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Treasury</h1>
          <p className="text-xs text-muted">Noncustodial revenue collection, monitoring and accounting.</p>
        </div>
        <div className="flex-1" />
        <Badge tone="brand">{me!.actor.role}</Badge>
        <span className="text-xs text-muted num">{me!.actor.address.slice(0, 6)}…{me!.actor.address.slice(-4)}</span>
        {!me!.actor.fresh && <Button size="sm" variant="subtle" onClick={async () => { await signIn(); reload(); }} title={`Sensitive actions need a sign-in within ${c.freshMinutes} min`}>Re-authenticate</Button>}
      </div>
      {(c.devEncryptionKey || c.database === "pglite" || c.requiredApprovals < 2 || !c.cron) && (
        <Notice tone="warn" title="Not production-ready yet">
          <ul className="list-disc pl-4 space-y-0.5">
            {c.devEncryptionKey && <li>Using a local development encryption key — set <code>TREASURY_ENCRYPTION_KEY</code>.</li>}
            {c.database === "pglite" && <li>Using the embedded development database — set <code>DATABASE_URL</code> (PostgreSQL).</li>}
            {c.requiredApprovals < 2 && <li>Single-approver mode — set <code>TREASURY_REQUIRED_APPROVALS=2</code> for dual control.</li>}
            {!c.cron && <li>Scheduled indexing disabled — set <code>CRON_SECRET</code>.</li>}
          </ul>
        </Notice>
      )}
      <div className="border-b border-line"><Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} value={tab} onChange={(t) => router.replace(`/admin/treasury?tab=${t}`)} /></div>
      {tab === "overview" && <Overview me={me!} />}
      {tab === "treasuries" && <Treasuries me={me!} />}
      {tab === "setup" && <Setup me={me!} onDone={() => router.replace("/admin/treasury?tab=governance")} />}
      {tab === "assets" && <Operations me={me!} />}
      {tab === "records" && <Records />}
      {tab === "validation" && <Validation me={me!} />}
      {tab === "governance" && <Governance me={me!} />}
      <p className="text-[11px] text-faint flex gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" /> Revenue figures count only fees confirmed on-chain. Swap volume and quotes are never counted as revenue.</p>
    </div>
  );
}

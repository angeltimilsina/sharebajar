"use client";
import { useState } from "react";
import { ExternalLink, ShieldCheck, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { CHAINS, getChain } from "@/lib/chains";
import { Badge, Button, Card, Notice } from "../ui/primitives";
import { ChainIcon } from "../ui/ChainIcon";
import { api, can, usePropose, type Me } from "./client";
import { TreasuryDetail, useTreasuries } from "./Treasuries";

/* eslint-disable @typescript-eslint/no-explicit-any */
const KINDS: Record<string, { id: string; label: string; desc: string; how: React.ReactNode }[]> = {
  solana: [
    { id: "wallet", label: "Wallet (Phantom-compatible)", desc: "Receives Jupiter /build platform fees into its token accounts.", how: <>Create a <b>new, dedicated</b> account in <a className="text-brand" href="https://phantom.com" target="_blank" rel="noopener noreferrer">Phantom</a>, Solflare or a hardware wallet (Ledger recommended). Copy its public address only.</> },
    { id: "squads", label: "Squads multisig (recommended)", desc: "Fees land in the multisig vault; moving funds needs member approvals.", how: <>Create a multisig at <a className="text-brand" href="https://squads.so" target="_blank" rel="noopener noreferrer">squads.so</a> (threshold ≥ 2). Paste the <b>multisig account</b> address — ShareBajar derives and verifies the vault.</> },
    { id: "jupiter_referral", label: "Jupiter referral account", desc: "For Swap V2 /order referral fees (50–255 bps; Jupiter keeps 20%).", how: <>Create a referral account at <a className="text-brand" href="https://referral.jup.ag" target="_blank" rel="noopener noreferrer">referral.jup.ag</a> using your treasury wallet as the partner. Paste the referral account address.</> },
  ],
  evm: [
    { id: "safe", label: "Safe smart account (recommended)", desc: "0x fees arrive at the Safe; transfers require owner signatures.", how: <>Deploy a Safe at <a className="text-brand" href="https://app.safe.global" target="_blank" rel="noopener noreferrer">app.safe.global</a> on this network (threshold ≥ 2). Paste the Safe address.</> },
    { id: "wallet", label: "Wallet (MetaMask-compatible)", desc: "An externally owned account receives 0x integrator fees.", how: <>Create a <b>new, dedicated</b> account in MetaMask or a hardware wallet. Copy its public address only.</> },
  ],
};

export function Setup({ me, onDone }: { me: Me; onDone: () => void }) {
  const [chain, setChain] = useState<string | null>(null);
  const [environment, setEnv] = useState<"mainnet" | "testnet">("mainnet");
  const [kind, setKind] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [vaultIndex, setVaultIndex] = useState(0);
  const [insp, setInsp] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const propose = usePropose();
  const { list } = useTreasuries();
  const [cont, setCont] = useState<string | null>(null);
  if (!can(me, "admin")) return <Notice>Only admins can register treasuries. You have read-only access.</Notice>;
  const c = chain ? getChain(chain) : null;
  const inProgress = (list ?? []).filter((t) => t.status !== "active" && t.status !== "disabled");

  return (
    <div className="space-y-4 max-w-4xl">
      <Notice tone="ai" title="ShareBajar never creates, imports or stores treasury keys">
        Create the wallet or multisig in your own wallet app. Here you only register its <b>public</b> address and prove control with a signature. Never enter a recovery phrase or private key anywhere on ShareBajar — we will never ask for one.
      </Notice>
      {inProgress.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-semibold mb-2">Continue setup</div>
          <div className="flex flex-wrap gap-2">{inProgress.map((t) => <Button key={t.id} size="sm" variant={cont === t.id ? "primary" : "subtle"} onClick={() => setCont(cont === t.id ? null : t.id)}><ChainIcon chain={t.chain} size={13} /> {t.label} · {t.status}</Button>)}</div>
        </Card>
      )}
      {cont ? <TreasuryDetail id={cont} me={me} /> : (
        <>
          <Card className="p-4 space-y-3">
            <div className="text-sm font-semibold">Step 1 · Select a network</div>
            <div className="flex flex-wrap gap-2">{CHAINS.map((x) => <button key={x.id} onClick={() => { setChain(x.id); setKind(null); setInsp(null); }} className={`h-9 inline-flex items-center gap-2 rounded-full border px-3.5 text-sm ${chain === x.id ? "border-brand/50 bg-brand-soft" : "border-line hover:bg-surface-2"}`}><ChainIcon chain={x.id} size={16} />{x.name}</button>)}</div>
            <div className="flex gap-2 text-xs">{(["mainnet", "testnet"] as const).map((e) => <button key={e} onClick={() => setEnv(e)} className={`px-2.5 py-1 rounded-md ${environment === e ? "bg-surface-3" : "text-muted"}`}>{e}</button>)}</div>
            {environment === "testnet" && <p className="text-[11px] text-warn">Testnet treasuries are for indexer testing only (Jupiter and 0x swap fees run on mainnet). EVM testnets need <code>RPC_URL_&lt;CHAIN&gt;_TESTNET</code>; Solana uses devnet.</p>}
          </Card>
          {c && (
            <Card className="p-4 space-y-3">
              <div className="text-sm font-semibold">Step 2 · Create the receiving account externally</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {KINDS[c.type].map((k) => (
                  <button key={k.id} onClick={() => { setKind(k.id); setInsp(null); }} className={`text-left rounded-xl border p-3 ${kind === k.id ? "border-brand/50 bg-brand-soft" : "border-line hover:bg-surface-2"}`}>
                    <div className="font-medium text-sm">{k.label}</div><div className="text-xs text-muted mt-0.5">{k.desc}</div>
                  </button>
                ))}
              </div>
              {kind && <div className="text-xs rounded-lg bg-surface-2 border border-line p-3 leading-relaxed">{KINDS[c.type].find((k) => k.id === kind)!.how}</div>}
            </Card>
          )}
          {c && kind && (
            <Card className="p-4 space-y-3">
              <div className="text-sm font-semibold">Step 3 · Register the public address</div>
              <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Label, e.g. Solana fees (Squads)" className="h-10 rounded-lg bg-surface-2 border border-line px-3 text-sm" />
                <input value={address} onChange={(e) => { setAddress(e.target.value.trim()); setInsp(null); }} placeholder={kind === "squads" ? "Squads multisig account address" : kind === "jupiter_referral" ? "Referral account address" : "Public address"} className="h-10 rounded-lg bg-surface-2 border border-line px-3 text-sm num" />
              </div>
              {kind === "squads" && <label className="text-xs text-muted">Vault index <input type="number" min={0} max={255} value={vaultIndex} onChange={(e) => setVaultIndex(Number(e.target.value))} className="ml-1 w-16 h-8 rounded-lg bg-surface-2 border border-line px-2" /></label>}
              <div className="flex gap-2">
                <Button size="sm" variant="subtle" disabled={busy || address.length < 32} onClick={async () => {
                  setBusy(true); setErr(null);
                  try { setInsp(await api("/api/treasury/inspect", { body: { chain, environment, kind, address, vaultIndex } })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
                }}>{busy && !insp ? <Loader2 size={13} className="animate-spin" /> : null} Inspect on-chain</Button>
              </div>
              {insp && (
                <div className="rounded-lg border border-line p-3 text-xs space-y-1.5">
                  <div className="flex items-center gap-2">{insp.ok ? <CheckCircle2 size={15} className="text-up" /> : <XCircle size={15} className="text-down" />}<span className="font-medium">{insp.ok ? "Address looks valid" : "Cannot register this address"}</span></div>
                  <div>Receiving address: <span className="num">{insp.receivingAddress}</span> <a className="text-brand inline-flex items-center gap-0.5" href={`${c.explorer.address}${insp.receivingAddress}`} target="_blank" rel="noopener noreferrer">explorer<ExternalLink size={10} /></a></div>
                  {Object.entries(insp.facts ?? {}).filter(([k]) => !["members", "owners"].includes(k)).map(([k, v]) => <div key={k} className="text-muted">{k}: <span className="num">{String(v)}</span></div>)}
                  {insp.facts?.members && <div className="text-muted">members: {(insp.facts.members as string[]).length}</div>}
                  {insp.facts?.owners && <div className="text-muted">owners: {(insp.facts.owners as string[]).join(", ")}</div>}
                  {insp.warnings.map((w: string) => <div key={w} className="text-warn flex gap-1"><AlertTriangle size={12} className="shrink-0 mt-0.5" />{w}</div>)}
                  {insp.errors.map((w: string) => <div key={w} className="text-down">{w}</div>)}
                </div>
              )}
              {err && <div className="text-xs text-down">{err}</div>}
              {done ? <Notice title="Registration requested">{done} <button className="text-brand" onClick={onDone}>Go to approvals →</button></Notice> : (
                <Button disabled={!insp?.ok || !label.trim() || busy} onClick={async () => {
                  setBusy(true); setErr(null);
                  try {
                    const r = await propose("register_treasury", { chain, environment, kind, address, vaultIndex, label: label.trim(), expectedReceivingAddress: insp.receivingAddress });
                    setDone(r.change.status === "applied" ? "Registered. Continue with ownership verification under Treasuries." : `Change ${r.change.id} needs approval from another admin before the address is registered.`);
                  } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
                }}><ShieldCheck size={15} /> Sign & submit registration</Button>
              )}
              <p className="text-[11px] text-faint">Registration is a signed change request{me.config.requiredApprovals > 1 ? ` that needs ${me.config.requiredApprovals - 1} more admin approval(s)` : ""}. Steps 4–8 (ownership, fee tokens, token accounts, validation, testing & activation) continue on the treasury page.</p>
            </Card>
          )}
          <div className="flex gap-2 text-xs text-muted"><Badge>Steps 4–8</Badge> Verify ownership → configure fee tokens → initialize token accounts → validate → test & activate.</div>
        </>
      )}
    </div>
  );
}

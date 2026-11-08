"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle, ExternalLink, Loader2, ShieldAlert, AlertTriangle, MinusCircle } from "lucide-react";
import { getChain } from "@/lib/chains";
import { KNOWN_TOKENS } from "@/lib/treasury/tokens";
import { shortAddress } from "@/lib/format";
import { useWallet } from "../wallet/WalletProvider";
import { getSolanaProvider, solanaSignAndSend } from "@/lib/wallet/solana";
import { SOLANA_RPC } from "@/lib/wallet/rpc";
import { Badge, Button, Card, CardHeader, Notice } from "../ui/primitives";
import { ChainIcon } from "../ui/ChainIcon";
import { api, can, fmtUsd, STATUS_TONE, usePropose, useSigner, type Me } from "./client";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface T {
  id: string; chain: string; chainType: string; environment: string; label: string; address: string; kind: string; status: string; integrityOk: boolean;
  ownership: { method: string; signer: string; verifiedAt: string; detail: string } | null; inspection: any; feeConfig: { provider: string; mode: string; feeBps: number; referralAccount?: string; tokens: { token: string; symbol: string; decimals: number; tokenAccount?: string }[] } | null;
}
const PIPE = ["registered", "verified", "validated", "testing", "active"];
const KIND_LABEL: Record<string, string> = { wallet: "Wallet", safe: "Safe smart account", squads: "Squads multisig vault", jupiter_referral: "Jupiter referral account" };

export function useTreasuries() {
  const [list, setList] = useState<T[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(() => api<{ treasuries: T[] }>("/api/treasury/treasuries").then((r) => setList(r.treasuries)).catch((e) => setErr(e.message)), []);
  useEffect(() => { reload(); }, [reload]);
  return { list, err, reload };
}

export function Treasuries({ me }: { me: Me }) {
  const { list, err, reload } = useTreasuries();
  const [sel, setSel] = useState<string | null>(null);
  if (err) return <Notice tone="down">{err}</Notice>;
  if (!list) return <div className="text-sm text-muted py-8 text-center">Loading…</div>;
  const current = list.find((t) => t.id === sel) ?? list[0];
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader title="Registered treasuries" action={can(me, "admin") ? <Link href="/admin/treasury?tab=setup" className="text-xs text-brand">+ Add</Link> : undefined} />
        <ul className="px-2 pb-2">
          {!list.length && <li className="px-3 py-6 text-xs text-muted">No treasuries yet. Use the setup wizard to register one.</li>}
          {list.map((t) => (
            <li key={t.id}>
              <button onClick={() => setSel(t.id)} className={`w-full text-left rounded-lg px-3 py-2.5 ${current?.id === t.id ? "bg-surface-3" : "hover:bg-surface-2"}`}>
                <div className="flex items-center gap-2"><ChainIcon chain={t.chain} size={15} /><span className="font-medium text-sm flex-1 truncate">{t.label}</span><Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge></div>
                <div className="text-[11px] text-muted num mt-0.5">{KIND_LABEL[t.kind]} · {shortAddress(t.address, 6, 4)}{!t.integrityOk && <span className="text-down"> · INTEGRITY FAILURE</span>}</div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {current ? <TreasuryDetail key={current.id} id={current.id} me={me} onChange={reload} /> : <div />}
    </div>
  );
}

function Check({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return <div className="flex gap-2 text-sm">{ok === null ? <MinusCircle size={16} className="text-faint shrink-0 mt-0.5" /> : ok ? <CheckCircle2 size={16} className="text-up shrink-0 mt-0.5" /> : <XCircle size={16} className="text-down shrink-0 mt-0.5" />}<div className="flex-1">{children}</div></div>;
}

export function TreasuryDetail({ id, me, onChange }: { id: string; me: Me; onChange?: () => void }) {
  const [d, setD] = useState<{ treasury: T; validation: any[]; testIntents: number; testRevenue: any[] } | null>(null);
  const [bal, setBal] = useState<{ balances: any[]; totalUsd: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "warn" | "down"; text: string } | null>(null);
  const { sign, wallet } = useSigner();
  const { solana } = useWallet();
  const propose = usePropose();
  const load = useCallback(() => { api<any>(`/api/treasury/treasuries/${id}`).then(setD).catch((e) => setMsg({ tone: "down", text: e.message })); api<any>(`/api/treasury/treasuries/${id}/balances`).then(setBal).catch(() => setBal(null)); }, [id]);
  useEffect(() => { load(); }, [load]);
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key); setMsg(null);
    try { const m = await fn(); if (m) setMsg({ tone: "info", text: m }); load(); onChange?.(); }
    catch (e) { setMsg({ tone: "down", text: /reject|denied/i.test((e as Error).message) ? "Cancelled in wallet." : (e as Error).message }); }
    finally { setBusy(null); }
  };
  if (!d) return <Card className="p-6 text-sm text-muted">Loading treasury…</Card>;
  const t = d.treasury;
  const c = getChain(t.chain)!;
  const stage = PIPE.indexOf(t.status);
  const explorer = `${c.explorer.address}${t.address}`;
  const signerHint = t.kind === "wallet" ? "the treasury wallet itself" : t.kind === "safe" ? "a wallet that is an owner of this Safe" : t.kind === "squads" ? "a wallet that is a member of this Squads multisig" : "the referral account's partner (admin) wallet";

  return (
    <div className="space-y-4 min-w-0">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ChainIcon chain={t.chain} size={20} /><h2 className="text-lg font-semibold">{t.label}</h2>
          <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
          <Badge tone={t.environment === "mainnet" ? "neutral" : "info"}>{t.environment}</Badge>
          {t.integrityOk ? <Badge tone="up">integrity ✓</Badge> : <Badge tone="down"><ShieldAlert size={11} /> integrity failed</Badge>}
        </div>
        <div className="text-xs text-muted">{KIND_LABEL[t.kind]} on {c.name} · <a href={explorer} target="_blank" rel="noopener noreferrer" className="num hover:text-brand inline-flex items-center gap-1">{t.address}<ExternalLink size={10} /></a></div>
        {t.kind === "squads" && <div className="text-xs text-muted">Multisig {t.inspection?.multisig} · vault #{t.inspection?.vaultIndex} · threshold {t.inspection?.threshold}/{t.inspection?.members?.length}</div>}
        {t.kind === "safe" && <div className="text-xs text-muted">Safe {t.inspection?.version ?? ""} · threshold {t.inspection?.threshold}/{t.inspection?.owners?.length}</div>}
        {t.kind === "jupiter_referral" && <div className="text-xs text-muted">Partner {t.inspection?.partner} · project {shortAddress(t.inspection?.project ?? "", 6, 6)}</div>}
        <div className="flex items-center gap-1 text-[11px]">{PIPE.map((p, i) => <span key={p} className={`px-2 py-1 rounded-md ${i <= stage ? "bg-brand-soft text-brand" : "bg-surface-3 text-faint"}`}>{i + 1}. {p}</span>)}</div>
        {!t.integrityOk && <Notice tone="down" title="Integrity failure">This record no longer matches its cryptographic seal. Fee collection is disabled for it. Investigate database access and re-register the treasury.</Notice>}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Step 4 · Verify ownership</div>
        <Check ok={!!t.ownership}>{t.ownership ? <>Verified by <span className="num">{shortAddress(t.ownership.signer, 6, 4)}</span> ({t.ownership.method}) — {t.ownership.detail} <span className="text-faint">{new Date(t.ownership.verifiedAt).toLocaleString()}</span></> : <>Sign a message with {signerHint}. In your wallet, switch to that account first. This is a text signature — no transaction, no fees, no key export.</>}</Check>
        {can(me, "admin") && !t.ownership && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">Connected: {wallet ? <span className="num">{shortAddress(wallet.address, 6, 4)}</span> : "none"}</span>
            <Button size="sm" disabled={!!busy || !wallet} onClick={() => run("own", async () => {
              const m = await api<{ message: string }>(`/api/treasury/treasuries/${id}`, { body: { op: "ownership-message" } });
              const s = await sign(m.message);
              await api(`/api/treasury/treasuries/${id}`, { body: { op: "verify-ownership", signer: s.signer, message: m.message, signature: s.signature } });
              return "Ownership verified.";
            })}>{busy === "own" ? <Loader2 size={13} className="animate-spin" /> : null} Sign ownership message</Button>
          </div>
        )}
      </Card>

      <FeeConfigCard t={t} me={me} propose={propose} onDone={(m) => setMsg({ tone: "info", text: m })} />

      {t.chainType === "solana" && t.feeConfig && (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-semibold">Step 6 · {t.feeConfig.mode === "referral" ? "Referral token accounts" : "Fee token accounts"}</div>
          <p className="text-xs text-muted">{t.feeConfig.mode === "referral" ? "Jupiter only pays referral fees into an initialized referral token account for the fee mint. If one is missing, the swap still works but without your fee." : "Jupiter /build sends the platform fee to a token account owned by the treasury for the output token. Each fee token needs one."}</p>
          <ul className="space-y-1.5">
            {(t.inspection?.feeAccounts ?? t.feeConfig.tokens.map((x) => ({ token: x.token, account: x.tokenAccount, initialized: null }))).map((a: any) => {
              const sym = t.feeConfig!.tokens.find((x) => x.token === a.token)?.symbol;
              return <Check key={a.account} ok={a.initialized}><span className="font-medium">{sym}</span> <a className="num text-xs text-muted hover:text-brand" href={`${c.explorer.address}${a.account}`} target="_blank" rel="noopener noreferrer">{shortAddress(a.account, 6, 6)}</a> {a.detail && <span className="text-xs text-faint">({a.detail})</span>}</Check>;
            })}
          </ul>
          {can(me, "operator") && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="subtle" disabled={!!busy} onClick={() => run("check", async () => { await api(`/api/treasury/treasuries/${id}`, { body: { op: "check-accounts" } }); return "Accounts re-checked on-chain."; })}>Re-check on-chain</Button>
              <Button size="sm" disabled={!!busy || wallet?.chainType !== "solana"} title={wallet?.chainType !== "solana" ? "Connect a Solana wallet to pay the account rent" : undefined} onClick={() => run("init", async () => {
                const r = await api<{ transaction: string; created: string[]; simulation: { err: unknown } }>(`/api/treasury/treasuries/${id}`, { body: { op: "init-accounts-tx", payer: wallet!.address } });
                if (r.simulation.err) throw new Error(`Simulation failed: ${JSON.stringify(r.simulation.err)} — not sent.`);
                const p = solana() ?? getSolanaProvider(wallet!.walletId);
                if (!p) throw new Error("Wallet unavailable");
                const sig = await solanaSignAndSend(p, r.transaction, SOLANA_RPC);
                await new Promise((res) => setTimeout(res, 6000));
                await api(`/api/treasury/treasuries/${id}`, { body: { op: "check-accounts" } });
                return `Submitted ${sig.slice(0, 10)}… creating ${r.created.length} account(s). Paid by your connected wallet (rent ≈ 0.002 SOL each).`;
              })}>Initialize missing accounts</Button>
            </div>
          )}
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between"><div className="text-sm font-semibold">Step 7 · Validate configuration</div>
          {can(me, "operator") && <Button size="sm" variant="subtle" disabled={!!busy || !t.feeConfig} onClick={() => run("val", async () => { const r = await api<{ results: any[] }>(`/api/treasury/treasuries/${id}`, { body: { op: "validate" } }); return `${r.results.filter((x) => x.outcome === "pass").length}/${r.results.length} checks passed.`; })}>{busy === "val" ? <Loader2 size={13} className="animate-spin" /> : null} Run validation</Button>}
        </div>
        {!d.validation.length && <p className="text-xs text-muted">Not run yet.</p>}
        <ul className="space-y-1.5">
          {d.validation.map((v) => <li key={v.key} className="flex gap-2 text-sm">{v.outcome === "pass" ? <CheckCircle2 size={16} className="text-up shrink-0 mt-0.5" /> : v.outcome === "warn" ? <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" /> : v.outcome === "skip" ? <MinusCircle size={16} className="text-faint shrink-0 mt-0.5" /> : <XCircle size={16} className="text-down shrink-0 mt-0.5" />}<span><span className="font-medium">{v.label}</span>{!v.required && <span className="text-faint"> (advisory)</span>} — <span className="text-muted">{v.detail}</span></span></li>)}
        </ul>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Step 8 · Test, then activate</div>
        <p className="text-xs text-muted">In <b>testing</b>, the fee is charged only on swaps made by admin wallets (shown with a TEST badge), so you can make small real swaps and confirm the fee lands here before customers pay anything. Activation needs a confirmed test fee, passing validation and {me.config.requiredApprovals > 1 ? "a second admin's approval" : "your signature"}.</p>
        <div className="text-xs"><b>{d.testIntents}</b> test swaps reported · <b>{d.testRevenue.filter((r) => r.status === "confirmed").length}</b> confirmed test fees</div>
        {d.testRevenue.length > 0 && <ul className="text-xs space-y-1">{d.testRevenue.map((r) => <li key={r.id} className="num"><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> {r.amount} {r.token_symbol} · <a className="hover:text-brand" href={`${c.explorer.tx}${r.tx_hash}`} target="_blank" rel="noopener noreferrer">{shortAddress(r.tx_hash, 8, 6)}</a> · <Badge tone={STATUS_TONE[r.reconciliation]}>{r.reconciliation}</Badge></li>)}</ul>}
        <div className="flex flex-wrap gap-2">
          {can(me, "admin") && t.status === "validated" && <Button size="sm" disabled={!!busy} onClick={() => run("test", async () => { await api(`/api/treasury/treasuries/${id}`, { body: { op: "set-status", status: "testing" } }); return "Testing mode on. Make a small swap from an admin wallet on /trade, then run reconciliation."; })}>Enter testing mode</Button>}
          {t.status === "testing" && <Link href={t.chainType === "solana" ? "/trade" : "/trade"}><Button size="sm" variant="subtle">Open Trade for a test swap</Button></Link>}
          {can(me, "admin") && ["validated", "testing"].includes(t.status) && <Button size="sm" disabled={!!busy} onClick={() => run("act", async () => { const r = await propose("activate", { treasuryId: id }); return r.change.status === "applied" ? "Activated — fee collection is live." : `Activation requested (${r.change.id}). Another admin must approve it under Approvals.`; })}>Propose activation</Button>}
          {can(me, "admin") && t.status !== "disabled" && <Button size="sm" variant="danger" disabled={!!busy} onClick={() => confirm("Disable fee collection for this treasury immediately?") && run("dis", async () => { await api(`/api/treasury/treasuries/${id}`, { body: { op: "set-status", status: "disabled" } }); return "Disabled. No new swaps will route fees here."; })}>Disable now</Button>}
          {can(me, "admin") && t.status === "disabled" && <Button size="sm" variant="subtle" disabled={!!busy} onClick={() => run("en", async () => { await api(`/api/treasury/treasuries/${id}`, { body: { op: "set-status", status: "verified" } }); return "Re-enabled at 'verified'. Re-run validation and activation."; })}>Re-enable</Button>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Balances" sub={bal ? `Est. ${fmtUsd(bal.totalUsd)} · live from ${t.chainType === "solana" ? "Solana RPC" : `${c.name} RPC`}` : "loading…"} />
        <table className="w-full text-xs num mb-3">
          <thead className="text-faint"><tr><th className="text-left font-normal px-4 py-1">Token</th><th className="text-right font-normal">Amount</th><th className="text-right font-normal">Price</th><th className="text-right font-normal px-4">USD</th></tr></thead>
          <tbody>{bal?.balances.map((b) => <tr key={b.account + b.token} className="border-t border-line/60"><td className="px-4 py-1.5">{b.symbol}{b.native && <span className="text-faint"> (native)</span>}</td><td className="text-right">{b.amount}</td><td className="text-right" title={b.priceSource}>{b.usdPrice === null ? "—" : fmtUsd(b.usdPrice)}</td><td className="text-right px-4">{fmtUsd(b.usdValue)}</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}

function FeeConfigCard({ t, me, propose, onDone }: { t: T; me: Me; propose: ReturnType<typeof usePropose>; onDone: (m: string) => void }) {
  const mode = t.kind === "jupiter_referral" ? "referral" : t.chainType === "solana" ? "platform" : "integrator";
  const rule = me.config.rules[`${t.chainType === "solana" ? "jupiter" : "0x"}:${mode}`];
  const [bps, setBps] = useState(String(t.feeConfig?.feeBps ?? (mode === "referral" ? Math.max(50, me.config.defaultFeeBps) : me.config.defaultFeeBps)));
  const known = KNOWN_TOKENS[t.chain] ?? [];
  const [picked, setPicked] = useState<string[]>(t.feeConfig?.tokens.map((x) => x.token) ?? known.filter((k) => k.stable || k.symbol === "SOL").map((k) => k.token));
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = Number(bps);
  const invalid = !Number.isInteger(n) || n < rule.min || n > Math.min(rule.max, me.config.maxFeeBps);
  return (
    <Card className="p-4 space-y-3">
      <div className="text-sm font-semibold">Step 5 · Fee tokens & rate</div>
      <p className="text-xs text-muted">{rule.label}: allowed {rule.min}–{Math.min(rule.max, me.config.maxFeeBps)} bps.{rule.providerShareBps ? ` The provider keeps ${rule.providerShareBps / 100}% of this fee.` : ""} {mode === "referral" && me.config.defaultFeeBps < 50 ? `The platform default (${me.config.defaultFeeBps} bps) is below Jupiter's referral minimum, so referral mode starts at 50 bps — or use a Solana wallet treasury (platform fee via /build) to charge ${me.config.defaultFeeBps} bps.` : ""}{mode === "platform" ? " The fee is taken from the output token, so it only applies when users receive one of the selected tokens." : ""}{mode === "integrator" ? " The fee is paid in the buy or sell token, whichever is selected below (native coins excluded so every fee is verifiable from Transfer events)." : ""}</p>
      {t.feeConfig && <div className="text-xs">Current: <b>{t.feeConfig.feeBps} bps</b> · {t.feeConfig.tokens.map((x) => x.symbol).join(", ")}</div>}
      {can(me, "admin") && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-muted">Fee (bps) <input value={bps} onChange={(e) => setBps(e.target.value.replace(/\D/g, ""))} className="ml-1 w-20 h-8 rounded-lg bg-surface-2 border border-line px-2 text-sm num" /></label>
            <span className="text-xs text-muted">= {(n / 100).toFixed(2)}%</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {known.map((k) => <label key={k.token} className={`text-xs rounded-lg border px-2.5 py-1.5 cursor-pointer ${picked.includes(k.token) ? "border-brand/50 bg-brand-soft" : "border-line"}`}><input type="checkbox" className="hidden" checked={picked.includes(k.token)} onChange={() => setPicked((p) => (p.includes(k.token) ? p.filter((x) => x !== k.token) : [...p, k.token]))} />{k.symbol}</label>)}
            {picked.filter((p) => !known.some((k) => k.token === p)).map((p) => <Badge key={p}>{shortAddress(p)}</Badge>)}
          </div>
          <div className="flex gap-2"><input value={custom} onChange={(e) => setCustom(e.target.value.trim())} placeholder="Add token mint / contract address" className="flex-1 h-8 rounded-lg bg-surface-2 border border-line px-2 text-xs num" /><Button size="sm" variant="subtle" disabled={!custom} onClick={() => { setPicked((p) => [...new Set([...p, custom])]); setCustom(""); }}>Add</Button></div>
          {err && <div className="text-xs text-down">{err}</div>}
          <Button size="sm" disabled={busy || invalid || !picked.length} onClick={async () => {
            setBusy(true); setErr(null);
            try { const r = await propose("update_fees", { treasuryId: t.id, feeConfig: { feeBps: n, tokens: picked } }); onDone(r.change.status === "applied" ? "Fee configuration applied. Re-run validation." : `Fee change requested (${r.change.id}); awaiting a second approval.`); }
            catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>Propose fee configuration</Button>
          <p className="text-[11px] text-faint">Changing fees returns the treasury to “verified”; it must be validated and activated again.</p>
        </>
      )}
    </Card>
  );
}

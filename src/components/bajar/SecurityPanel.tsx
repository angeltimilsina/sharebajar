"use client";
import { useEffect, useState } from "react";
import { Download, Eye, KeyRound, LogIn, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, Notice, Badge } from "../ui/primitives";
import { bajar, authLog, changePassword, exportBackup, loadVault, removeWallet, revealMnemonic, saveSettings, settings } from "@/lib/bajar/session";
import { PQ_ALG } from "@/lib/bajar/keys";
import { environmentChecks, passwordStrength } from "@/lib/bajar/security";
import { needsKdfUpgrade } from "@/lib/bajar/vault";
import { currentSession, hybridSignIn, type BajarSession } from "@/lib/bajar/auth";

const input = "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand";

export function SecurityPanel() {
  const a = bajar.accounts()!;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Checkup />
      <Card>
        <CardHeader title="Post-quantum identity" icon={<ShieldCheck size={16} className="text-brand" />} sub={`${PQ_ALG} (FIPS 204) key derived from your recovery phrase`} />
        <div className="px-4 pb-4 space-y-2 text-xs">
          <div><span className="text-muted">Fingerprint</span> <span className="font-mono">{a.pq.fingerprint}</span></div>
          <details><summary className="cursor-pointer text-muted">Public key (1952 bytes)</summary><div className="font-mono break-all text-[10px] mt-1 max-h-28 overflow-auto">{a.pq.publicKey}</div></details>
          <Notice tone="info" title="What this protects — and what it doesn't">
            ML-DSA-65 signs your Bajar sign-in, your encrypted backups and a local log of every approval. Bitcoin, Ethereum and Solana do <b>not</b> accept ML-DSA signatures today, so on-chain transactions still use each network&apos;s own scheme (secp256k1 / Ed25519). This is a supplementary protection, not quantum-resistant transactions.
          </Notice>
          <HybridSignIn />
        </div>
      </Card>
      <BackupCard />
      <PasswordCard />
      <Card>
        <CardHeader title="Session & connections" />
        <div className="px-4 pb-4 space-y-3 text-sm">
          <label className="flex items-center justify-between gap-2">Auto-lock after
            <select className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm" defaultValue={settings().autoLockMinutes} onChange={(e) => saveSettings({ autoLockMinutes: Number(e.target.value) })}>
              {[1, 5, 10, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
          <p className="text-xs text-muted">Use Bajar Wallet on Bajar pages via <b>Connect wallet → Bajar Wallet</b> (Solana or EVM).</p>
          <p className="text-xs text-muted"><b>WalletConnect</b>: not enabled on this deployment (requires a WalletConnect project ID). <b>Hardware wallets</b>: not supported yet — use Ledger/Trezor through their own apps or browser extensions.</p>
          <Button variant="danger" size="sm" onClick={() => { if (confirm("Remove the encrypted wallet from this browser? Make sure you have your recovery phrase or a backup.")) removeWallet(); }}><Trash2 size={13} className="mr-1" />Remove wallet from this browser</Button>
        </div>
      </Card>
      <AuthLogCard />
    </div>
  );
}

function HybridSignIn() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button size="sm" disabled={busy} onClick={async () => {
        setMsg(null); setBusy(true);
        try { const s = await hybridSignIn(); setMsg({ ok: true, text: `Signed in · both signatures verified by the server (PQ ${String(s.pq?.fingerprint ?? "").split(":").pop()?.slice(0, 8)}).` }); }
        catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
      }} data-testid="bajar-hybrid-signin"><LogIn size={13} className="mr-1" />Sign in to Bajar (hybrid)</Button>
      {msg && <p className={`mt-1 text-xs ${msg.ok ? "text-up" : "text-down"}`} data-testid="bajar-hybrid-result">{msg.text}</p>}
    </div>
  );
}

function Checkup() {
  const [session, setSession] = useState<BajarSession | null | undefined>(undefined);
  useEffect(() => { currentSession().then(setSession); }, []);
  const s = settings();
  const v = loadVault();
  const a = bajar.accounts()!;
  const items: { label: string; ok: boolean; detail: string; weight: number }[] = [
    ...environmentChecks().map((c) => ({ label: c.label, ok: c.ok, detail: c.detail, weight: 3 })),
    { label: "Recovery backed up", ok: !!s.backedUpAt, detail: s.backedUpAt ? `${s.backupMethod === "file" ? "Encrypted backup file" : s.backupMethod === "imported" ? "Imported from your existing phrase" : "Phrase verified"} · ${new Date(s.backedUpAt).toLocaleDateString()}` : "Download an encrypted backup below, or write down your phrase.", weight: 3 },
    { label: "Strong password", ok: s.passwordScore === undefined ? true : s.passwordScore >= 3, detail: s.passwordScore === undefined ? "Set before strength scoring existed — consider changing it." : ["Very weak", "Weak", "Fair", "Strong", "Very strong"][s.passwordScore], weight: 2 },
    { label: "Auto-lock ≤ 15 minutes", ok: s.autoLockMinutes <= 15, detail: `Locks after ${s.autoLockMinutes} min of inactivity.`, weight: 1 },
    { label: "Current encryption settings", ok: !!v && !needsKdfUpgrade(v), detail: v ? `scrypt N=2^${Math.log2(v.kdf.N)}, AES-256-GCM, vault v${v.version}` : "No vault", weight: 1 },
    { label: "Signed in with post-quantum check", ok: !!session?.pq && session.address === a.solana.address, detail: session === undefined ? "Checking…" : session?.pq && session.address === a.solana.address ? `Session verified with ${session.pq.alg} · expires ${new Date(session.exp).toLocaleDateString()}` : "Optional: sign in (hybrid) to link this wallet to your Bajar session.", weight: 1 },
  ];
  const total = items.reduce((t, i) => t + i.weight, 0), got = items.reduce((t, i) => t + (i.ok ? i.weight : 0), 0);
  const score = Math.round((got / total) * 100);
  return (
    <Card className="lg:col-span-2" data-testid="bajar-checkup">
      <CardHeader title="Security checkup" icon={<ShieldCheck size={16} className={score >= 85 ? "text-up" : "text-warn"} />} sub="Runs on this device. Nothing is sent to Bajar." action={<Badge tone={score >= 85 ? "up" : score >= 60 ? "warn" : "down"}>{score}/100</Badge>} />
      <ul className="divide-y divide-line">
        {items.map((i) => (
          <li key={i.label} className="flex items-start gap-2 px-4 py-2.5 text-sm">
            {i.ok ? <ShieldCheck size={15} className="text-up mt-0.5 shrink-0" /> : <ShieldAlert size={15} className="text-warn mt-0.5 shrink-0" />}
            <span className="min-w-0"><span className="block">{i.label}</span><span className="block text-xs text-muted">{i.detail}</span></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BackupCard() {
  const [pw, setPw] = useState("");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Backup & recovery" />
      <div className="px-4 pb-4 space-y-3">
        <Button size="sm" variant="outline" onClick={() => {
          const blob = new Blob([exportBackup()], { type: "application/json" });
          const u = URL.createObjectURL(blob); const el = document.createElement("a");
          el.href = u; el.download = `bajar-backup-${new Date().toISOString().slice(0, 10)}.json`; el.click(); URL.revokeObjectURL(u);
        }}><Download size={13} className="mr-1" />Download encrypted backup</Button>
        <p className="text-[11px] text-muted">The backup is encrypted with your password and signed with ML-DSA-65 so tampering is detected on restore.</p>
        <div className="flex gap-2">
          <input type="password" className={input} placeholder="Password to reveal phrase" value={pw} onChange={(e) => setPw(e.target.value)} />
          <Button size="sm" variant="outline" disabled={!pw} onClick={async () => { setErr(null); try { const r = await revealMnemonic(pw); setPhrase(r.mnemonic + (r.passphrase ? "\n\nBIP-39 passphrase: set (required to restore — not shown)" : "") + (r.solanaPath === "bip44" ? "\nSolana account scheme: m/44'/501'/0' (Trust/Exodus)" : "")); setPw(""); setTimeout(() => setPhrase(null), 60_000); } catch (e) { setErr((e as Error).message); } }}><Eye size={13} /></Button>
        </div>
        {err && <p className="text-xs text-down">{err}</p>}
        {phrase && <Notice tone="warn" title="Recovery phrase (hidden again in 60s)"><span className="font-mono text-xs whitespace-pre-wrap">{phrase}</span></Notice>}
      </div>
    </Card>
  );
}

function PasswordCard() {
  const [o, setO] = useState(""), [n, setN] = useState(""), [n2, setN2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(n);
  return (
    <Card>
      <CardHeader title="Change password" icon={<KeyRound size={16} />} />
      <div className="px-4 pb-4 space-y-2">
        <input type="password" className={input} placeholder="Current password" value={o} onChange={(e) => setO(e.target.value)} />
        <input type="password" className={input} placeholder="New password (min. 12)" value={n} onChange={(e) => setN(e.target.value)} autoComplete="new-password" />
        {n && <p className={`text-xs ${strength.ok ? "text-up" : "text-muted"}`}>{strength.label}{!strength.ok && strength.issues[0] ? ` — ${strength.issues[0]}` : ""}</p>}
        <input type="password" className={input} placeholder="Repeat new password" value={n2} onChange={(e) => setN2(e.target.value)} />
        {msg && <p className="text-xs">{msg}</p>}
        <Button size="sm" disabled={busy || !o || !strength.ok || n !== n2} onClick={async () => { setBusy(true); setMsg(null); try { await changePassword(o, n); setMsg("Password changed. Download a new backup."); setO(""); setN(""); setN2(""); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Re-encrypting…" : "Change password"}</Button>
      </div>
    </Card>
  );
}

function AuthLogCard() {
  const log = authLog();
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Authorization log" sub="Every approval you gave, signed locally with ML-DSA-65 (SHA-256 digest of the request)." />
      <ul className="divide-y divide-line max-h-72 overflow-auto">
        {!log.length && <li className="p-4 text-sm text-muted">No approvals yet.</li>}
        {log.map((r) => (
          <li key={r.at + r.pqSignature.slice(0, 12)} className="px-4 py-2 text-xs flex gap-2 items-center">
            <Badge tone={r.action === "sign_transaction" ? "brand" : "neutral"}>{r.action === "sign_transaction" ? "tx" : "msg"}</Badge>
            <span className="text-muted w-20 shrink-0">{r.network}</span>
            <span className="flex-1 truncate">{r.summary}</span>
            <span className="font-mono text-faint hidden sm:inline" title={r.digest}>{r.digest.slice(0, 10)}…</span>
            <span className="text-faint">{new Date(r.at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

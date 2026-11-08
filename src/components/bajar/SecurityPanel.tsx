"use client";
import { useState } from "react";
import { Download, Eye, KeyRound, LogIn, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, Notice, Badge } from "../ui/primitives";
import { bajar, authLog, changePassword, exportBackup, removeWallet, revealMnemonic, saveSettings, settings } from "@/lib/bajar/session";
import { pqSign, solanaSign, PQ_ALG } from "@/lib/bajar/keys";
import { requestApproval } from "@/lib/bajar/approvals";

const input = "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand";

export function SecurityPanel() {
  const a = bajar.accounts()!;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
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
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setMsg(null);
    try {
      const a = bajar.accounts()!;
      const n = await (await fetch(`/api/auth/nonce?chainType=solana&address=${a.solana.address}&pqPublicKey=${encodeURIComponent(a.pq.publicKey)}`)).json();
      if (!n.message) throw new Error(n.error ?? "Could not start sign-in");
      const ok = await requestApproval({ kind: "message", network: "Bajar", title: "Hybrid sign-in (Ed25519 + ML-DSA-65)", rows: [["Account", a.solana.address], ["PQ key", a.pq.fingerprint]], raw: n.message }, { message: n.message });
      if (!ok) throw new Error("Sign-in cancelled.");
      const s = bajar.secrets();
      const r = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature: solanaSign(s.solana, n.message), pqSignature: pqSign(s.pq, n.message, "auth"), pqPublicKey: a.pq.publicKey }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setMsg(`Signed in · both signatures verified by the server (PQ ${String(b.session.pq?.fingerprint ?? "").split(":").pop()?.slice(0, 8)}).`);
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div>
      <Button size="sm" onClick={run} data-testid="bajar-hybrid-signin"><LogIn size={13} className="mr-1" />Sign in to Bajar (hybrid)</Button>
      {msg && <p className="mt-1 text-xs" data-testid="bajar-hybrid-result">{msg}</p>}
    </div>
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
          <Button size="sm" variant="outline" disabled={!pw} onClick={async () => { setErr(null); try { setPhrase(await revealMnemonic(pw)); setPw(""); setTimeout(() => setPhrase(null), 60_000); } catch (e) { setErr((e as Error).message); } }}><Eye size={13} /></Button>
        </div>
        {err && <p className="text-xs text-down">{err}</p>}
        {phrase && <Notice tone="warn" title="Recovery phrase (hidden again in 60s)"><span className="font-mono text-xs">{phrase}</span></Notice>}
      </div>
    </Card>
  );
}

function PasswordCard() {
  const [o, setO] = useState(""), [n, setN] = useState(""), [n2, setN2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Change password" icon={<KeyRound size={16} />} />
      <div className="px-4 pb-4 space-y-2">
        <input type="password" className={input} placeholder="Current password" value={o} onChange={(e) => setO(e.target.value)} />
        <input type="password" className={input} placeholder="New password (min. 10)" value={n} onChange={(e) => setN(e.target.value)} />
        <input type="password" className={input} placeholder="Repeat new password" value={n2} onChange={(e) => setN2(e.target.value)} />
        {msg && <p className="text-xs">{msg}</p>}
        <Button size="sm" disabled={busy || !o || n.length < 10 || n !== n2} onClick={async () => { setBusy(true); setMsg(null); try { await changePassword(o, n); setMsg("Password changed. Download a new backup."); setO(""); setN(""); setN2(""); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Re-encrypting…" : "Change password"}</Button>
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

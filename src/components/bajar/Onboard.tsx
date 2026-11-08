"use client";
import { useMemo, useState } from "react";
import { KeyRound, Download, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button, Card, Notice, Tabs } from "../ui/primitives";
import { newMnemonic, isValidMnemonic, normalizeMnemonic } from "@/lib/bajar/keys";
import { createAndStore, importBackup, unlock, removeWallet } from "@/lib/bajar/session";

const input = "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand";

function PasswordFields({ pw, setPw, pw2, setPw2 }: { pw: string; setPw: (s: string) => void; pw2?: string; setPw2?: (s: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2">
      <div className="relative">
        <input data-testid="bajar-password" type={show ? "text" : "password"} className={input} placeholder="Wallet password (min. 10 characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <button type="button" className="absolute right-2 top-2 text-muted" onClick={() => setShow(!show)} aria-label="Toggle password">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      </div>
      {setPw2 && <input data-testid="bajar-password2" type={show ? "text" : "password"} className={input} placeholder="Repeat password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />}
    </div>
  );
}

function Progress({ p }: { p: number | null }) {
  if (p === null) return null;
  return <div className="text-xs text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Deriving encryption key (scrypt)… {Math.round(p * 100)}%</div>;
}

export function Onboard() {
  const [mode, setMode] = useState<"create" | "import" | "backup">("create");
  return (
    <Card className="p-4 sm:p-5 max-w-xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Bajar Wallet</h1>
      <p className="text-sm text-muted mb-4">A noncustodial wallet for Bitcoin, Ethereum/EVM and Solana. Your recovery phrase is generated and encrypted in this browser and never sent to Bajar servers.</p>
      <Tabs tabs={[{ id: "create", label: "Create" }, { id: "import", label: "Import" }, { id: "backup", label: "Restore" }]} value={mode} onChange={setMode} className="mb-4" />
      {mode === "create" ? <Create /> : mode === "import" ? <ImportPhrase /> : <RestoreBackup />}
    </Card>
  );
}

function Create() {
  const [strength, setStrength] = useState<128 | 256>(128);
  const [seed, setSeed] = useState(0);
  const phrase = useMemo(() => newMnemonic(strength), [strength, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = phrase.split(" ");
  const [step, setStep] = useState<"show" | "confirm" | "password">("show");
  const checks = useMemo(() => { const idx = [...words.keys()].sort(() => Math.random() - 0.5).slice(0, 3).sort((a, b) => a - b); return idx; }, [phrase]); // eslint-disable-line react-hooks/exhaustive-deps
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  if (step === "show") return (
    <div className="space-y-3">
      <div className="flex gap-2 text-xs">
        <Button size="sm" variant={strength === 128 ? "primary" : "outline"} onClick={() => setStrength(128)}>12 words</Button>
        <Button size="sm" variant={strength === 256 ? "primary" : "outline"} onClick={() => setStrength(256)}>24 words</Button>
        <Button size="sm" variant="ghost" onClick={() => { setSeed(seed + 1); setRevealed(false); }}>Regenerate</Button>
      </div>
      <Notice tone="warn" title="Write these words down, in order">Anyone with this phrase controls your funds. Bajar will never ask for it. Store it offline — it is the only way to recover the wallet.</Notice>
      <div className={`relative grid grid-cols-3 gap-1.5 ${revealed ? "" : "blur-sm select-none"}`} data-testid="bajar-phrase">
        {words.map((w, i) => <div key={i} className="rounded-md bg-surface-2 border border-line px-2 py-1 text-xs font-mono"><span className="text-faint mr-1">{i + 1}.</span>{w}</div>)}
      </div>
      {!revealed && <Button variant="outline" className="w-full" onClick={() => setRevealed(true)} data-testid="bajar-reveal"><Eye size={14} className="mr-1" />Reveal phrase (check nobody is watching)</Button>}
      <Button className="w-full" disabled={!revealed} onClick={() => setStep("confirm")}>I wrote it down</Button>
    </div>
  );
  if (step === "confirm") return (
    <div className="space-y-3">
      <p className="text-sm">Confirm your phrase:</p>
      {checks.map((i) => <input key={i} data-testid={`bajar-confirm-${i}`} className={input} placeholder={`Word #${i + 1}`} value={answers[i] ?? ""} onChange={(e) => setAnswers({ ...answers, [i]: e.target.value.trim().toLowerCase() })} />)}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep("show")}>Back</Button>
        <Button className="flex-1" disabled={!checks.every((i) => answers[i] === words[i])} onClick={() => setStep("password")}>Continue</Button>
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">This password encrypts the phrase on this device (scrypt + AES-256-GCM). It cannot be recovered — the phrase can.</p>
      <PasswordFields pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />
      {err && <Notice tone="down">{err}</Notice>}
      <Progress p={progress} />
      <Button className="w-full" data-testid="bajar-create" disabled={pw.length < 10 || pw !== pw2 || progress !== null} onClick={async () => {
        setErr(null); setProgress(0);
        try { await createAndStore(phrase, pw, setProgress); } catch (e) { setErr((e as Error).message); } finally { setProgress(null); }
      }}><KeyRound size={14} className="mr-1" />Create wallet</Button>
    </div>
  );
}

function ImportPhrase() {
  const [phrase, setPhrase] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const valid = isValidMnemonic(phrase);
  return (
    <div className="space-y-3">
      <Notice tone="warn">Only enter your recovery phrase here, on your own device. It stays in this browser and is encrypted before storage.</Notice>
      <textarea data-testid="bajar-import-phrase" className={`${input} h-24 font-mono`} placeholder="12 or 24 word recovery phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} />
      {phrase && !valid && <p className="text-xs text-down">Not a valid BIP-39 phrase (check spelling and word count).</p>}
      <PasswordFields pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />
      {err && <Notice tone="down">{err}</Notice>}
      <Progress p={progress} />
      <Button className="w-full" data-testid="bajar-import" disabled={!valid || pw.length < 10 || pw !== pw2 || progress !== null} onClick={async () => {
        setErr(null); setProgress(0);
        try { await createAndStore(normalizeMnemonic(phrase), pw, setProgress); setPhrase(""); } catch (e) { setErr((e as Error).message); } finally { setProgress(null); }
      }}>Import wallet</Button>
    </div>
  );
}

function RestoreBackup() {
  const [json, setJson] = useState(""), [pw, setPw] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Restore an encrypted Bajar backup file. Its ML-DSA-65 signature is verified before it is accepted.</p>
      <input type="file" accept="application/json,.json" className="text-xs" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setJson(await f.text()); }} />
      <textarea className={`${input} h-20 font-mono text-[11px]`} placeholder="…or paste backup JSON" value={json} onChange={(e) => setJson(e.target.value)} />
      <PasswordFields pw={pw} setPw={setPw} />
      {err && <Notice tone="down">{err}</Notice>}
      <Progress p={progress} />
      <Button className="w-full" disabled={!json || pw.length < 10 || progress !== null} onClick={async () => {
        setErr(null); setProgress(0);
        try { await importBackup(json, pw); } catch (e) { setErr((e as Error).message); } finally { setProgress(null); }
      }}><Download size={14} className="mr-1" />Restore</Button>
    </div>
  );
}

export function Unlock() {
  const [pw, setPw] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null); setProgress(0);
    try { await unlock(pw, setProgress); setPw(""); } catch (e) { setErr((e as Error).message); } finally { setProgress(null); }
  };
  return (
    <Card className="p-5 max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-1">Unlock Bajar Wallet</h1>
      <p className="text-sm text-muted mb-4">Your encrypted wallet is stored in this browser.</p>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <PasswordFields pw={pw} setPw={setPw} />
        {err && <Notice tone="down">{err}</Notice>}
        <Progress p={progress} />
        <Button className="w-full" type="submit" data-testid="bajar-unlock" disabled={!pw || progress !== null}>Unlock</Button>
      </form>
      <button className="mt-4 text-[11px] text-muted underline" onClick={() => { if (confirm("Remove the encrypted wallet from this browser? You will need your recovery phrase or a backup to restore it.")) removeWallet(); }}>Remove wallet from this browser</button>
    </Card>
  );
}

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, Download, Eye, EyeOff, FileKey2, KeyRound, Loader2, LogIn, ShieldAlert, ShieldCheck, Upload, XCircle } from "lucide-react";
import clsx from "clsx";
import { Badge, Button, Card, Notice, Tabs } from "../ui/primitives";
import { newMnemonic, isValidMnemonic, normalizeMnemonic, phraseWords, PHRASE_LENGTHS, SOLANA_PATHS, solanaAddressFor, deriveAll, type SolanaPathId } from "@/lib/bajar/keys";
import { createAndStore, importBackup, unlock, removeWallet, unlockWait, bajar, settings } from "@/lib/bajar/session";
import { analyzePhrase, environmentChecks, isBip39Word, MIN_PASSWORD, passwordStrength, quizChoices, quizPositions, suggestWords, unlockFailures } from "@/lib/bajar/security";
import { assertVaultShape, verifyVaultSignature, type VaultFile } from "@/lib/bajar/vault";
import { hybridSignIn } from "@/lib/bajar/auth";

const input = "w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[15px] sm:text-sm outline-none focus:border-line-strong focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand)_25%,transparent)]";

/* ------------------------------ Shell ------------------------------ */

export function Onboard({ onFinish }: { onFinish: () => void }) {
  const [mode, setMode] = useState<"create" | "import" | "backup">("create");
  const [locked, setLocked] = useState(false); // once a flow starts, don't allow switching mid-way
  const env = useMemo(() => environmentChecks(), []);
  const envBad = env.filter((c) => !c.ok);
  return (
    <Card className="p-4 sm:p-6 max-w-xl mx-auto">
      <div className="flex items-center gap-2 mb-1"><ShieldCheck size={20} className="text-accent" /><h1 className="text-xl font-bold">Bajar Wallet</h1></div>
      <p className="text-sm text-muted mb-4">A self-custody wallet for Bitcoin, Ethereum/EVM and Solana. Your recovery phrase is created and encrypted on this device and is never sent to Bajar servers.</p>
      {envBad.length > 0 && (
        <Notice tone="down" title="This environment is not safe for a wallet" className="mb-4">
          <ul className="list-disc pl-4">{envBad.map((c) => <li key={c.id}>{c.detail}</li>)}</ul>
        </Notice>
      )}
      {!locked && <Tabs tabs={[{ id: "create", label: "Create new" }, { id: "import", label: "Import" }, { id: "backup", label: "Restore" }]} value={mode} onChange={setMode} className="mb-4" />}
      {mode === "create" ? <Create onStart={() => setLocked(true)} onFinish={onFinish} />
        : mode === "import" ? <ImportPhrase onStart={() => setLocked(true)} onFinish={onFinish} />
        : <RestoreBackup onStart={() => setLocked(true)} onFinish={onFinish} />}
    </Card>
  );
}

function Steps({ steps, at }: { steps: string[]; at: number }) {
  // Each step starts at the top (important on phones).
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [at]);
  return (
    <ol className="flex items-center gap-1.5 mb-4 text-[11px]" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5 min-w-0" aria-current={i === at ? "step" : undefined}>
          <span className={clsx("grid place-items-center h-5 w-5 shrink-0 rounded-full border text-[10px] font-bold", i < at ? "bg-accent/15 border-accent/40 text-accent" : i === at ? "border-line-strong text-fg" : "border-line text-faint")}>{i < at ? <Check size={11} /> : i + 1}</span>
          <span className={clsx("truncate", i === at ? "text-fg font-medium" : "text-faint", i !== at && "hidden sm:inline")}>{s}</span>
          {i < steps.length - 1 && <span className="w-3 sm:w-5 h-px bg-line shrink-0" />}
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------- Password ----------------------------- */

function StrengthMeter({ pw }: { pw: string }) {
  const r = passwordStrength(pw);
  if (!pw) return null;
  const tone = r.score >= 3 ? "bg-up" : r.score === 2 ? "bg-warn" : "bg-down";
  return (
    <div aria-live="polite">
      <div className="flex gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={clsx("h-1 flex-1 rounded-full", i < Math.max(1, r.score) ? tone : "bg-surface-3")} />)}</div>
      <div className="mt-1 flex justify-between text-[11px]"><span className={r.ok ? "text-up" : "text-muted"}>{r.label}</span><span className="text-faint">~{r.bits} bits</span></div>
      {!r.ok && r.issues.length > 0 && <ul className="mt-1 text-[11px] text-muted list-disc pl-4">{r.issues.slice(0, 3).map((i) => <li key={i}>{i}</li>)}</ul>}
    </div>
  );
}

function PasswordStep({ onNext, cta = "Continue" }: { onNext: (pw: string) => void; cta?: string }) {
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [show, setShow] = useState(false), [ack, setAck] = useState(false);
  const r = passwordStrength(pw);
  const match = pw.length > 0 && pw === pw2;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (r.ok && match && ack) onNext(pw); }}>
      <p className="text-sm text-muted">This password encrypts your wallet on this device. It unlocks Bajar here only — your recovery phrase restores it anywhere.</p>
      <div className="relative">
        <input data-testid="bajar-password" type={show ? "text" : "password"} className={input} placeholder={`New password (min. ${MIN_PASSWORD} characters)`} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus />
        <button type="button" className="absolute right-2.5 top-2.5 text-muted" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
      </div>
      <StrengthMeter pw={pw} />
      <input data-testid="bajar-password2" type={show ? "text" : "password"} className={input} placeholder="Repeat password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      {pw2 && !match && <p className="text-xs text-down">Passwords don&apos;t match.</p>}
      <label className="flex items-start gap-2 text-xs text-muted">
        <input data-testid="bajar-pw-ack" type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        I understand Bajar cannot recover this password. If I forget it, I need my recovery phrase or backup.
      </label>
      <Button type="submit" className="w-full h-11" data-testid="bajar-pw-next" disabled={!r.ok || !match || !ack}>{cta}</Button>
    </form>
  );
}

function Encrypting({ p }: { p: number }) {
  return (
    <div className="py-8 text-center space-y-3" aria-live="polite">
      <Loader2 className="mx-auto animate-spin text-muted" />
      <p className="text-sm">Encrypting your wallet on this device…</p>
      <div className="mx-auto max-w-xs h-1.5 rounded-full bg-surface-3 overflow-hidden"><div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(p * 100)}%` }} /></div>
      <p className="text-[11px] text-faint">scrypt (N=2¹⁷) + AES-256-GCM. This is intentionally slow to resist password guessing.</p>
    </div>
  );
}

/* ----------------------------- Create ------------------------------ */

function Create({ onStart, onFinish }: { onStart: () => void; onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const [pw, setPw] = useState("");
  const [strength, setStrength] = useState<128 | 256>(128);
  const [nonce, setNonce] = useState(0);
  const phrase = useMemo(() => newMnemonic(strength), [strength, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = phrase.split(" ");
  const [revealed, setRevealed] = useState(false);
  const [written, setWritten] = useState(false);
  const positions = useMemo(() => quizPositions(words.length, 3), [phrase]); // eslint-disable-line react-hooks/exhaustive-deps
  const choices = useMemo(() => Object.fromEntries(positions.map((p) => [p, quizChoices(words, p)])), [positions]); // eslint-disable-line react-hooks/exhaustive-deps
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const STEPS = ["Before you start", "Password", "Recovery phrase", "Verify", "Done"];

  // Hide the phrase when the tab loses focus (shoulder-surfing, screen recorders).
  useEffect(() => {
    if (step !== 2) return;
    const hide = () => { if (document.visibilityState === "hidden") setRevealed(false); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [step]);

  const finish = async () => {
    setErr(null); setProgress(0);
    try { await createAndStore(phrase, pw, setProgress, "phrase_quiz"); setPw(""); setStep(4); }
    catch (e) { setErr((e as Error).message); }
    finally { setProgress(null); }
  };

  if (progress !== null) return <Encrypting p={progress} />;
  return (
    <div>
      <Steps steps={STEPS} at={step} />
      {step === 0 && (
        <div className="space-y-3">
          <ul className="space-y-2 text-sm">
            {["You'll get a 12- or 24-word recovery phrase. It controls all your funds.", "Write it on paper. No screenshots, cloud notes, email or chat.", "Bajar staff will never ask for it. Anyone who does is a scammer.", "Make sure nobody can see your screen."].map((t) => (
              <li key={t} className="flex gap-2"><ShieldCheck size={16} className="text-accent shrink-0 mt-0.5" />{t}</li>
            ))}
          </ul>
          <Button className="w-full h-11" data-testid="bajar-start" onClick={() => { onStart(); setStep(1); }}>I&apos;m ready</Button>
        </div>
      )}
      {step === 1 && <PasswordStep onNext={(p) => { setPw(p); setStep(2); }} />}
      {step === 2 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={strength === 128 ? "primary" : "outline"} onClick={() => { setStrength(128); setRevealed(false); setWritten(false); }}>12 words</Button>
            <Button size="sm" variant={strength === 256 ? "primary" : "outline"} onClick={() => { setStrength(256); setRevealed(false); setWritten(false); }}>24 words</Button>
            <Button size="sm" variant="ghost" onClick={() => { setNonce(nonce + 1); setRevealed(false); setWritten(false); }}>New phrase</Button>
          </div>
          <div className="relative">
            <ol className={clsx("grid grid-cols-2 sm:grid-cols-3 gap-1.5 select-none", !revealed && "blur-md pointer-events-none")} data-testid="bajar-phrase" aria-hidden={!revealed}>
              {words.map((w, i) => <li key={i} className="rounded-md bg-surface-2 border border-line px-2 py-1.5 text-sm font-mono"><span className="text-faint mr-1.5 tabular-nums">{i + 1}.</span>{revealed ? w : "•••••"}</li>)}
            </ol>
            {!revealed && <button className="absolute inset-0 grid place-items-center text-sm font-semibold" onClick={() => setRevealed(true)} data-testid="bajar-reveal"><span className="inline-flex items-center gap-2 rounded-lg bg-surface-3/90 border border-line px-3 py-2"><Eye size={15} />Tap to reveal</span></button>}
          </div>
          <Notice tone="warn">Never share these words. Copying is disabled on purpose — write them down by hand.</Notice>
          <label className="flex items-start gap-2 text-xs text-muted"><input type="checkbox" className="mt-0.5" checked={written} disabled={!revealed} onChange={(e) => setWritten(e.target.checked)} data-testid="bajar-written" />I wrote down all {words.length} words in order and stored them somewhere safe.</label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button className="flex-1 h-11" disabled={!revealed || !written} onClick={() => { setRevealed(false); setAnswers({}); setStep(3); }} data-testid="bajar-phrase-next">Continue</Button>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm">Tap the correct word for each position.</p>
          {positions.map((p) => (
            <fieldset key={p}>
              <legend className="text-xs text-muted mb-1.5">Word #{p + 1}</legend>
              <div className="flex flex-wrap gap-1.5" data-testid={`bajar-quiz-${p}`}>
                {choices[p].map((c) => {
                  const picked = answers[p] === c;
                  return <button key={c} type="button" onClick={() => setAnswers({ ...answers, [p]: c })} className={clsx("rounded-lg border px-3 py-1.5 text-sm font-mono", picked ? (c === words[p] ? "border-up/60 bg-up/10" : "border-down/60 bg-down/10") : "border-line hover:bg-surface-2")}>{c}</button>;
                })}
              </div>
            </fieldset>
          ))}
          {positions.some((p) => answers[p] && answers[p] !== words[p]) && <p className="text-xs text-down">One or more words are wrong. Check your written copy.</p>}
          {err && <Notice tone="down">{err}</Notice>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>Show phrase again</Button>
            <Button className="flex-1 h-11" data-testid="bajar-create" disabled={!positions.every((p) => answers[p] === words[p])} onClick={finish}><KeyRound size={15} />Create wallet</Button>
          </div>
        </div>
      )}
      {step === 4 && <Done onFinish={onFinish} />}
    </div>
  );
}

/* ----------------------------- Import ------------------------------ */

function ImportPhrase({ onStart, onFinish }: { onStart: () => void; onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const [count, setCount] = useState<number>(12);
  const [words, setWords] = useState<string[]>(() => Array(24).fill(""));
  const [focus, setFocus] = useState<number | null>(null);
  const [show, setShow] = useState(false);
  const [ackPublic, setAckPublic] = useState(false);
  const [pasted, setPasted] = useState(false);
  const [usePass, setUsePass] = useState(false);
  const [pass, setPass] = useState(""), [pass2, setPass2] = useState("");
  const [solanaPath, setSolanaPath] = useState<SolanaPathId>("standard");
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const active = words.slice(0, count);
  const phrase = active.join(" ").trim();
  const filled = active.filter(Boolean).length;
  const checksum = filled === count && isValidMnemonic(phrase);
  const rep = analyzePhrase(phrase, checksum);
  const badIdx = new Set(active.map((w, i) => (w && !isBip39Word(w) && (focus !== i || !wordlistHasPrefix(w)) ? i : -1)).filter((i) => i >= 0));
  const passOk = !usePass || (pass.length > 0 && pass === pass2);
  const canContinue = filled === count && badIdx.size === 0 && checksum && (!rep.publicPhrase || ackPublic) && passOk;
  const STEPS = ["Recovery phrase", "Accounts", "Password", "Done"];

  // Wipe phrase from memory/state when leaving the screen.
  useEffect(() => () => { setWords(Array(24).fill("")); setPass(""); setPass2(""); }, []);

  /** Put words starting at index `at`; a pasted/typed phrase fills the following boxes. */
  const putWords = (at: number, raw: string) => {
    const incoming = phraseWords(raw);
    onStart();
    if (incoming.length > 1) {
      const total = at + incoming.length;
      const fit = (PHRASE_LENGTHS as readonly number[]).find((n) => n >= total) ?? 24;
      if (at === 0 && (PHRASE_LENGTHS as readonly number[]).includes(incoming.length)) setCount(incoming.length);
      else if (fit > count) setCount(fit);
      setWords((w) => { const n = [...w]; incoming.slice(0, 24 - at).forEach((x, i) => (n[at + i] = x)); return n; });
      // Phrase complete → close the keyboard; otherwise jump to the next empty box.
      const newCount = at === 0 && (PHRASE_LENGTHS as readonly number[]).includes(incoming.length) ? incoming.length : Math.max(fit, count);
      const next = at + incoming.length;
      setTimeout(() => { if (next >= newCount) (document.activeElement as HTMLElement | null)?.blur(); else refs.current[next]?.focus(); }, 0);
      return;
    }
    // Single word typed. A trailing separator (space/enter) moves to the next box.
    const endsWithSep = /[^a-zA-Z]$/.test(raw) && raw.trim().length > 0;
    setWords((w) => { const n = [...w]; n[at] = incoming[0] ?? ""; return n; });
    if (endsWithSep && incoming[0] && at < count - 1) setTimeout(() => refs.current[at + 1]?.focus(), 0);
  };

  const pick = (i: number, w: string) => {
    setWords((ws) => { const n = [...ws]; n[i] = w; return n; });
    if (i < count - 1) setTimeout(() => refs.current[i + 1]?.focus(), 0);
  };

  const finish = async (pw: string) => {
    setErr(null); setProgress(0);
    try {
      await createAndStore({ mnemonic: normalizeMnemonic(phrase), passphrase: usePass ? pass : undefined, solanaPath }, pw, setProgress, "imported");
      setWords(Array(24).fill("")); setPass(""); setPass2("");
      setStep(3);
    } catch (e) { setErr((e as Error).message); setStep(2); }
    finally { setProgress(null); }
  };

  if (progress !== null) return <Encrypting p={progress} />;
  const suggestions = focus !== null && words[focus] && !isBip39Word(words[focus]) ? suggestWords(words[focus], 4) : [];
  return (
    <div>
      <Steps steps={STEPS} at={step} />
      {step === 0 && (
        <div className="space-y-3">
          <Notice tone="warn">Only enter your phrase on your own device, at this exact site. It is encrypted on this device and never uploaded.</Notice>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Number of words">
            {PHRASE_LENGTHS.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={count === n} onClick={() => setCount(n)} data-testid={`bajar-len-${n}`}
                className={clsx("h-8 px-3 rounded-lg border text-xs font-semibold", count === n ? "btn-silver border-transparent" : "border-line text-muted hover:text-fg")}>{n} words</button>
            ))}
            <button type="button" className="ml-auto h-8 px-2 text-muted inline-flex items-center gap-1 text-xs" onClick={() => setShow(!show)} aria-label={show ? "Hide words" : "Show words"}>{show ? <EyeOff size={15} /> : <Eye size={15} />}{show ? "Hide" : "Show"}</button>
          </div>
          <p className="text-[11px] text-muted">Tip: paste the whole phrase into the first box — numbers, commas and line breaks are ignored.</p>
          <ol className="grid grid-cols-2 sm:grid-cols-3 gap-1.5" data-testid="bajar-import-grid">
            {active.map((w, i) => (
              <li key={i} className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-faint tabular-nums select-none">{i + 1}.</span>
                <input
                  ref={(el) => { refs.current[i] = el; }}
                  data-testid={i === 0 ? "bajar-import-phrase" : `bajar-word-${i}`}
                  aria-label={`Word ${i + 1}`}
                  aria-invalid={badIdx.has(i)}
                  type={show ? "text" : "password"}
                  value={w}
                  onChange={(e) => putWords(i, e.target.value)}
                  onPaste={(e) => { e.preventDefault(); putWords(i, e.clipboardData.getData("text")); setPasted(true); setTimeout(() => navigator.clipboard?.writeText?.("").catch(() => {}), 300); }}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === "Tab") && suggestions.length === 1 && focus === i) { e.preventDefault(); pick(i, suggestions[0]); }
                    else if (e.key === "Enter") { e.preventDefault(); refs.current[Math.min(i + 1, count - 1)]?.focus(); }
                    else if (e.key === "Backspace" && !w && i > 0) { e.preventDefault(); refs.current[i - 1]?.focus(); }
                  }}
                  onFocus={() => setFocus(i)}
                  onBlur={() => setFocus((f) => (f === i ? null : f))}
                  autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint={i === count - 1 ? "done" : "next"}
                  className={clsx("w-full rounded-lg border bg-surface-2 pl-7 pr-2 py-2.5 text-[15px] sm:text-sm font-mono outline-none", badIdx.has(i) ? "border-down/70" : w && isBip39Word(w) ? "border-line-strong" : "border-line", "focus:border-line-strong focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand)_25%,transparent)]")}
                />
              </li>
            ))}
          </ol>
          {suggestions.length > 0 && focus !== null && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-live="polite">
              <span className="text-muted">Word {focus + 1}:</span>
              {suggestions.map((s) => <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(focus, s)} className="rounded-md border border-line px-2 py-1 font-mono hover:bg-surface-2">{s}</button>)}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 text-xs" aria-live="polite">
            <Badge tone={filled === count ? "up" : "neutral"}>{filled} / {count} words</Badge>
            {badIdx.size > 0 && <Badge tone="down">{badIdx.size} not in the BIP-39 list (#{[...badIdx].map((i) => i + 1).join(", #")})</Badge>}
            {filled === count && badIdx.size === 0 && <Badge tone={checksum ? "up" : "down"}>{checksum ? "Checksum OK" : "Checksum fails — a word is wrong or out of order"}</Badge>}
            {filled > 0 && <button type="button" className="text-muted underline" onClick={() => { setWords(Array(24).fill("")); setAckPublic(false); refs.current[0]?.focus(); }}>Clear</button>}
          </div>
          {pasted && <p className="text-[11px] text-muted">Pasted — Bajar tried to clear your clipboard. Clear it manually if your device keeps clipboard history.</p>}
          {rep.publicPhrase && (
            <Notice tone="down" title="This is a publicly known test phrase">
              Anyone can control these addresses. Bots steal funds sent to them within seconds. Only use it for testing.
              <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={ackPublic} onChange={(e) => setAckPublic(e.target.checked)} data-testid="bajar-ack-public" />I understand — this is only for testing.</label>
            </Notice>
          )}
          {rep.lowDiversity && !rep.publicPhrase && <Notice tone="warn">This phrase repeats many words. Randomly generated phrases rarely do — make sure it wasn&apos;t hand-picked.</Notice>}
          <details className="rounded-xl border border-line px-3 py-2 text-sm" open={usePass}>
            <summary className="cursor-pointer text-muted text-xs">Advanced: BIP-39 passphrase (&quot;25th word&quot;)</summary>
            <div className="mt-2 space-y-2">
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={usePass} onChange={(e) => setUsePass(e.target.checked)} data-testid="bajar-use-passphrase" />My wallet uses an extra passphrase (Ledger/Trezor/Electrum &quot;seed extension&quot;). Different passphrase = different wallet.</label>
              {usePass && (
                <>
                  <input type="password" className={input} placeholder="Passphrase (case-sensitive)" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
                  <input type="password" className={input} placeholder="Repeat passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="off" />
                  {pass2 && pass !== pass2 && <p className="text-xs text-down">Passphrases don&apos;t match.</p>}
                </>
              )}
            </div>
          </details>
          <Button className="w-full h-11" data-testid="bajar-import-next" disabled={!canContinue} onClick={() => setStep(1)}>Continue</Button>
        </div>
      )}
      {step === 1 && <AccountDiscovery phrase={phrase} passphrase={usePass ? pass : ""} value={solanaPath} onChange={setSolanaPath} onBack={() => setStep(0)} onNext={() => setStep(2)} />}
      {step === 2 && (
        <div className="space-y-3">
          {err && <Notice tone="down">{err}</Notice>}
          <PasswordStep cta="Import wallet" onNext={finish} />
          <Button variant="ghost" size="sm" onClick={() => setStep(1)}>Back</Button>
        </div>
      )}
      {step === 3 && <Done onFinish={onFinish} />}
    </div>
  );
}

const wordlistHasPrefix = (w: string) => suggestWords(w, 1).some((s) => s.startsWith(w));

/** Shows the addresses this phrase controls and finds which Solana scheme holds funds. */
function AccountDiscovery({ phrase, passphrase, value, onChange, onBack, onNext }: { phrase: string; passphrase: string; value: SolanaPathId; onChange: (v: SolanaPathId) => void; onBack: () => void; onNext: () => void }) {
  const accounts = useMemo(() => {
    const base = deriveAll(phrase, { passphrase });
    const sol = (Object.keys(SOLANA_PATHS) as SolanaPathId[]).map((id) => ({ id, address: solanaAddressFor(phrase, id, passphrase), label: SOLANA_PATHS[id].label, path: SOLANA_PATHS[id].path(0) }));
    return { btc: base.pub.bitcoin.address, evm: base.pub.evm.address, sol };
  }, [phrase, passphrase]);
  const [activity, setActivity] = useState<Record<string, { sol: number; used: boolean } | null>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const { walletRpc } = await import("@/lib/bajar/rpc");
      const res: Record<string, { sol: number; used: boolean } | null> = {};
      await Promise.all(accounts.sol.map(async (a) => {
        try {
          const [bal, sigs] = await Promise.all([
            walletRpc<{ value: number }>("solana", "getBalance", [a.address]),
            walletRpc<unknown[]>("solana", "getSignaturesForAddress", [a.address, { limit: 1 }]),
          ]);
          res[a.id] = { sol: bal.value / 1e9, used: bal.value > 0 || sigs.length > 0 };
        } catch { res[a.id] = null; }
      }));
      if (!alive) return;
      setActivity(res);
      // Prefer the standard scheme unless only the legacy one has history.
      if (!res.standard?.used && res.bip44?.used) onChange("bip44");
    })();
    return () => { alive = false; };
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const loading = Object.keys(activity).length === 0;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">These are the accounts your phrase controls. Bitcoin and EVM use the same standard paths as MetaMask, Ledger, Trust, Electrum and Sparrow.</p>
      <div className="rounded-xl border border-line divide-y divide-line text-xs">
        <div className="px-3 py-2"><div className="text-muted">Bitcoin · native SegWit (m/84&apos;/0&apos;/0&apos;/0/0)</div><div className="font-mono break-all">{accounts.btc}</div></div>
        <div className="px-3 py-2"><div className="text-muted">Ethereum & EVM (m/44&apos;/60&apos;/0&apos;/0/0)</div><div className="font-mono break-all">{accounts.evm}</div></div>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-xs text-muted mb-1">Solana account — pick the one your previous wallet used</legend>
        {accounts.sol.map((a) => {
          const act = activity[a.id];
          return (
            <label key={a.id} className={clsx("flex items-start gap-2 rounded-xl border p-3 cursor-pointer", value === a.id ? "border-line-strong bg-surface-2" : "border-line")}>
              <input type="radio" name="solpath" className="mt-1" checked={value === a.id} onChange={() => onChange(a.id)} data-testid={`bajar-solpath-${a.id}`} />
              <span className="min-w-0 text-xs">
                <span className="block font-semibold text-sm">{a.label}</span>
                <span className="block text-muted">{a.path}</span>
                <span className="block font-mono break-all">{a.address}</span>
                <span className="block mt-1">{loading ? <span className="text-muted inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" />Checking activity…</span> : act === null ? <span className="text-muted">Couldn&apos;t check</span> : act?.used ? <span className="text-up">Has history · {act.sol.toFixed(4)} SOL</span> : <span className="text-muted">No activity</span>}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {passphrase && <Notice tone="info">Using your BIP-39 passphrase. If these addresses look unfamiliar, the passphrase may be different from the one you used before.</Notice>}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button className="flex-1 h-11" onClick={onNext} data-testid="bajar-accounts-next">Continue</Button>
      </div>
    </div>
  );
}

/* ----------------------------- Restore ----------------------------- */

function RestoreBackup({ onStart, onFinish }: { onStart: () => void; onFinish: () => void }) {
  const [json, setJson] = useState("");
  const [pw, setPw] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const info = useMemo((): { ok: true; v: VaultFile; sig: boolean } | { ok: false; error: string } | null => {
    if (!json.trim()) return null;
    try { const v: unknown = JSON.parse(json); assertVaultShape(v); return { ok: true, v, sig: verifyVaultSignature(v) }; }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  }, [json]);

  if (done) return <Done onFinish={onFinish} />;
  if (progress !== null) return <Encrypting p={progress} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Restore from an encrypted Bajar backup file. Everything is checked before anything is decrypted.</p>
      <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong p-4 text-sm cursor-pointer hover:bg-surface-2">
        <Upload size={16} /> Choose backup file
        <input type="file" accept="application/json,.json" className="sr-only" data-testid="bajar-backup-file" onChange={async (e) => { const f = e.target.files?.[0]; if (f && f.size < 20_000) { setJson(await f.text()); onStart(); } else if (f) setErr("File too large to be a Bajar backup."); }} />
      </label>
      <details className="text-xs"><summary className="cursor-pointer text-muted">Paste backup text instead</summary>
        <textarea className={clsx(input, "mt-2 h-20 font-mono text-[11px]")} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
      </details>
      {info && !info.ok && <Notice tone="down"><span className="inline-flex gap-1"><XCircle size={14} />{info.error}</span></Notice>}
      {info?.ok && (
        <div className="rounded-xl border border-line p-3 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-semibold"><FileKey2 size={14} />Backup from {new Date(info.v.createdAt).toLocaleDateString()}</div>
          <div className={info.sig ? "text-up" : "text-down"}>{info.sig ? "✓ ML-DSA-65 signature valid" : "✗ Signature invalid — file modified or corrupted"}</div>
          <div className="text-muted">✓ Encryption settings within the safe range</div>
          <div className="text-muted font-mono truncate">BTC {info.v.accounts.bitcoin.address}</div>
          <div className="text-muted font-mono truncate">EVM {info.v.accounts.evm.address}</div>
          <div className="text-muted font-mono truncate">SOL {info.v.accounts.solana.address}</div>
        </div>
      )}
      <input type="password" className={input} placeholder="Backup password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" data-testid="bajar-backup-password" />
      {err && <Notice tone="down">{err}</Notice>}
      <Button className="w-full h-11" disabled={!info?.ok || !info.sig || pw.length < 10} onClick={async () => {
        setErr(null); setProgress(0);
        try { await importBackup(json, pw, setProgress); setPw(""); setDone(true); } catch (e) { setErr((e as Error).message); } finally { setProgress(null); }
      }}><Download size={15} />Verify & restore</Button>
    </div>
  );
}

/* ------------------------------ Done ------------------------------- */

function Done({ onFinish }: { onFinish: () => void }) {
  const a = bajar.accounts();
  const s = settings();
  const [signin, setSignin] = useState<{ state: "idle" | "busy" | "ok" | "err"; text?: string }>({ state: "idle" });
  const checks = [
    ...environmentChecks().map((c) => ({ label: c.label, ok: c.ok })),
    { label: "Encrypted on this device (scrypt + AES-256-GCM)", ok: true },
    { label: s.backupMethod === "phrase_quiz" ? "Recovery phrase verified" : s.backupMethod === "file" ? "Restored from verified backup" : "Recovery phrase imported", ok: true },
    { label: `Strong password${s.passwordScore !== undefined ? ` (${["very weak", "weak", "fair", "strong", "very strong"][s.passwordScore]})` : ""}`, ok: s.passwordScore === undefined || s.passwordScore >= 3 },
    { label: `Auto-lock after ${s.autoLockMinutes} min of inactivity`, ok: true },
  ];
  return (
    <div className="space-y-4" data-testid="bajar-done">
      <div className="text-center">
        <CheckCircle2 size={36} className="mx-auto text-accent" />
        <h2 className="mt-2 text-lg font-semibold">Your wallet is ready</h2>
      </div>
      <ul className="rounded-xl border border-line divide-y divide-line text-sm">
        {checks.map((c) => <li key={c.label} className="flex items-center gap-2 px-3 py-2">{c.ok ? <ShieldCheck size={15} className="text-up shrink-0" /> : <ShieldAlert size={15} className="text-warn shrink-0" />}{c.label}</li>)}
      </ul>
      {a && <div className="text-[11px] text-muted space-y-0.5 font-mono"><div className="truncate">BTC {a.bitcoin.address}</div><div className="truncate">EVM {a.evm.address}</div><div className="truncate">SOL {a.solana.address}</div></div>}
      <div className="rounded-xl border border-line p-3 space-y-2">
        <div className="text-sm font-medium">Sign in to Bajar <span className="text-muted font-normal">(optional)</span></div>
        <p className="text-xs text-muted">Proves you own this wallet with two signatures (Ed25519 + post-quantum ML-DSA-65), verified by the server. No transaction, no fees.</p>
        {signin.state === "ok" ? <p className="text-xs text-up" data-testid="bajar-signin-ok">{signin.text}</p> : (
          <Button size="sm" variant="outline" disabled={signin.state === "busy"} data-testid="bajar-done-signin" onClick={async () => {
            setSignin({ state: "busy" });
            try { const ss = await hybridSignIn(); setSignin({ state: "ok", text: `Signed in · both signatures verified (PQ ${ss.pq?.fingerprint.split(":").pop()?.slice(0, 8)})` }); }
            catch (e) { setSignin({ state: "err", text: (e as Error).message }); }
          }}>{signin.state === "busy" ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}Sign in</Button>
        )}
        {signin.state === "err" && <p className="text-xs text-down">{signin.text}</p>}
      </div>
      <Button className="w-full h-11" onClick={onFinish} data-testid="bajar-open">Open wallet</Button>
    </div>
  );
}

/* ------------------------------ Unlock ----------------------------- */

export function Unlock() {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [forgot, setForgot] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    const tick = () => setWait(unlockWait());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const submit = async () => {
    setErr(null); setProgress(0);
    try { await unlock(pw, setProgress); setPw(""); } catch (e) { setErr((e as Error).message); } finally { setProgress(null); setWait(unlockWait()); }
  };
  const fails = typeof window !== "undefined" ? unlockFailures() : 0;
  return (
    <Card className="p-4 sm:p-6 max-w-md mx-auto">
      <div className="flex items-center gap-2 mb-1"><KeyRound size={18} className="text-muted" /><h1 className="text-xl font-bold">Unlock Bajar Wallet</h1></div>
      <p className="text-sm text-muted mb-4">Your encrypted wallet is stored in this browser.</p>
      {!forgot ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!wait) submit(); }}>
          <div className="relative">
            <input data-testid="bajar-password" type={show ? "text" : "password"} className={input} placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus disabled={progress !== null} />
            <button type="button" className="absolute right-2.5 top-2.5 text-muted" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
          {err && <Notice tone="down">{err}</Notice>}
          {wait > 0 && <p className="text-xs text-warn" data-testid="bajar-throttle">Too many wrong attempts. Try again in {Math.ceil(wait / 1000)}s.</p>}
          {!wait && fails > 0 && fails < 3 && <p className="text-[11px] text-muted">{3 - fails} attempt(s) left before a timed lock.</p>}
          {progress !== null && <div className="h-1 rounded-full bg-surface-3 overflow-hidden"><div className="h-full bg-brand" style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
          <Button className="w-full h-11" type="submit" data-testid="bajar-unlock" disabled={!pw || progress !== null || wait > 0}>{progress !== null ? "Decrypting…" : "Unlock"}</Button>
          <button type="button" className="text-xs text-muted underline" onClick={() => setForgot(true)}>Forgot password?</button>
        </form>
      ) : (
        <div className="space-y-3 text-sm">
          <p>Bajar can&apos;t reset your password — it never had it. To regain access, remove the encrypted wallet from this browser and import it again with your <b>recovery phrase</b> or <b>backup file</b>.</p>
          <Notice tone="warn">Without your phrase or backup, removing the wallet means losing access to its funds.</Notice>
          <input className={input} placeholder='Type "REMOVE" to confirm' value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setForgot(false)}>Cancel</Button>
            <Button variant="danger" className="flex-1" disabled={confirmText !== "REMOVE"} onClick={() => removeWallet()}>Remove and re-import</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

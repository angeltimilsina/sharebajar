"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { BookOpen, Check, Copy, Droplets, ExternalLink, Flame, FlaskConical, GraduationCap, Loader2, RefreshCw, Rocket, ShieldAlert, ShieldOff, Wallet } from "lucide-react";
import type { Keypair } from "@solana/web3.js";
import { Badge, Button, Card, CardHeader, Notice } from "../ui/primitives";
import { airdrop, balanceSol, devnetExplorer, launchPractice, managePractice, practiceKey, practiceTokens, resetPracticeKey, tokenBalanceRaw, type PracticeToken } from "@/lib/learn/sandbox";

interface Lesson { id: string; title: string; minutes: number; body: string[]; quiz: { q: string; options: string[]; answer: number }; practice?: string }

const LESSONS: Lesson[] = [
  {
    id: "wallets", title: "Wallets and recovery phrases", minutes: 4,
    body: ["A wallet is a pair of keys. The public address is like an account number you can share; the private key (or the recovery phrase that creates it) is the only thing that can move your funds.", "Self-custody means nobody — not Bajar, not support staff — can recover or reverse anything for you. Write your phrase on paper and never type it into a website or chat.", "Bajar Wallet encrypts your keys on your device and adds a post-quantum (ML-DSA-65) signature for sign-in."],
    quiz: { q: "Someone from \"support\" asks for your recovery phrase to fix your account. What do you do?", options: ["Send it, they're support", "Refuse — nobody legitimate ever needs it", "Send half of it"], answer: 1 },
  },
  {
    id: "testnet", title: "Test networks and faucets", minutes: 3,
    body: ["Every major blockchain has a test network. Solana's is called devnet: same programs, same tools, but the coins are free and worth nothing.", "A faucet gives you test coins. Practising here means mistakes cost nothing.", "Your sandbox key below only works on devnet. Never send real funds to it."],
    quiz: { q: "What are devnet SOL worth?", options: ["The same as SOL", "Nothing — they're for testing", "Half of SOL"], answer: 1 },
    practice: "Get 1 test SOL in the sandbox.",
  },
  {
    id: "launch", title: "Launching a token", minutes: 5,
    body: ["On Solana a token is a mint account. Launching creates the mint, your token account, and metadata (name, symbol, logo), then mints the supply to you.", "The mint authority can create more tokens; the freeze authority can freeze holders. Buyers trust tokens where both are revoked.", "Launching costs a little SOL for rent (storage) and fees. Bajar's real launchpad shows every cost before you sign."],
    quiz: { q: "Why do buyers prefer a revoked mint authority?", options: ["It makes the token faster", "Nobody can print more tokens and dilute them", "It lowers fees"], answer: 1 },
    practice: "Launch a practice token in the sandbox.",
  },
  {
    id: "supply", title: "Supply: burning and authorities", minutes: 3,
    body: ["Burning destroys tokens from your balance and lowers the total supply, permanently.", "Revoking an authority is also permanent: once the mint authority is gone, the supply can never grow.", "Every action is a transaction you sign — check what you're signing."],
    quiz: { q: "Can you undo a burn?", options: ["Yes, within 24 hours", "No, it's permanent", "Only on weekends"], answer: 1 },
    practice: "Burn some practice tokens, then revoke the mint authority.",
  },
  {
    id: "liquidity", title: "Liquidity pools and pricing", minutes: 4,
    body: ["A token only trades once someone adds liquidity: a pool holding your token and a quote asset like SOL or USDC.", "The ratio you deposit sets the starting price. Example: 1,000,000 tokens + 10 SOL ⇒ 0.00001 SOL per token.", "Thin pools move a lot on small trades and are easy to manipulate. Locking LP tokens shows holders the liquidity can't be pulled instantly."],
    quiz: { q: "You add 500,000 tokens and 5 SOL. What's the starting price?", options: ["0.00001 SOL", "0.1 SOL", "100,000 SOL"], answer: 0 },
  },
  {
    id: "scams", title: "Spotting scams", minutes: 3,
    body: ["Red flags: active mint or freeze authority, one wallet holding most of the supply, tiny or unlocked liquidity, copycat names, pressure to buy fast.", "Approvals: a malicious site can ask you to approve spending your tokens. Read every approval.", "Bajar shows risk checks on token pages — use them before trading new tokens."],
    quiz: { q: "Which is a red flag on a new token?", options: ["Mint authority revoked", "Top wallet holds 80% of supply", "Liquidity locked for a year"], answer: 1 },
  },
];
const PROGRESS = "bajar.learn.progress";
const readProgress = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(PROGRESS) ?? "{}"); } catch { return {}; } };

export function LearnPage() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<string>("wallets");
  useEffect(() => setDone(readProgress()), []);
  const mark = (id: string) => setDone((d) => { const n = { ...d, [id]: true }; try { localStorage.setItem(PROGRESS, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const count = LESSONS.filter((l) => done[l.id]).length;

  return (
    <div className="space-y-5" data-testid="learn-page">
      <span data-app-page hidden />
      <div className="rounded-[28px] p-6 sm:p-8 text-white" style={{ background: "linear-gradient(135deg,#0f9d58,#0a84ff)" }}>
        <div className="flex items-center gap-2 text-[13px] font-semibold opacity-90"><GraduationCap size={16} /> Bajar Learn</div>
        <h1 className="mt-2 text-[30px] sm:text-[38px] leading-tight text-white">Learn crypto by doing — with test coins.</h1>
        <p className="mt-2 text-[15px] opacity-90 max-w-xl">Short lessons, a quiz for each, and a student sandbox on Solana devnet where you launch, burn and manage tokens for free. Nothing here uses real money.</p>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 w-48 rounded-full bg-white/25 overflow-hidden"><div className="h-full bg-white" style={{ width: `${(count / LESSONS.length) * 100}%` }} /></div>
          <span className="text-[13px] font-semibold" data-testid="learn-progress">{count} / {LESSONS.length} lessons</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><BookOpen size={16} className="text-brand" />Lessons</span>} sub="About 20 minutes in total" />
          <ul className="divide-y divide-line/70">
            {LESSONS.map((l, i) => (
              <li key={l.id} data-testid={`lesson-${l.id}`}>
                <button onClick={() => setOpen(open === l.id ? "" : l.id)} className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-surface-2/60" aria-expanded={open === l.id}>
                  <span className={clsx("h-7 w-7 rounded-full grid place-items-center text-[12px] font-semibold shrink-0", done[l.id] ? "bg-up text-white" : "bg-surface-2 text-muted")}>{done[l.id] ? <Check size={14} /> : i + 1}</span>
                  <span className="flex-1 min-w-0"><span className="block font-semibold text-[14.5px]">{l.title}</span><span className="block text-[12px] text-muted">{l.minutes} min{l.practice ? " · practice in the sandbox" : ""}</span></span>
                </button>
                {open === l.id && <LessonBody lesson={l} done={!!done[l.id]} onPass={() => mark(l.id)} />}
              </li>
            ))}
          </ul>
        </Card>
        <Sandbox />
      </div>
      <p className="text-[12px] text-faint">Ready for the real thing? <Link href="/wallet" className="underline">Create a Bajar Wallet</Link> and use the <Link href="/launchpad" className="underline">Launchpad</Link>. Real launches use real money and are permanent.</p>
    </div>
  );
}

function LessonBody({ lesson, done, onPass }: { lesson: Lesson; done: boolean; onPass: () => void }) {
  const [pick, setPick] = useState<number | null>(null);
  const correct = pick === lesson.quiz.answer;
  return (
    <div className="px-4 sm:px-5 pb-4 space-y-3">
      {lesson.body.map((p) => <p key={p} className="text-[14px] text-muted leading-relaxed">{p}</p>)}
      {lesson.practice && <Notice title="Practice"><span className="text-[13px]">{lesson.practice}</span></Notice>}
      <div className="rounded-2xl bg-surface-2 p-3 space-y-2" data-testid="quiz">
        <div className="text-[13.5px] font-semibold">{lesson.quiz.q}</div>
        {lesson.quiz.options.map((o, i) => (
          <button key={o} onClick={() => { setPick(i); if (i === lesson.quiz.answer) onPass(); }} className={clsx("w-full text-left rounded-xl px-3 py-2 text-[13.5px] border", pick === i ? (correct ? "border-up bg-up/10" : "border-down bg-down/10") : "border-line bg-surface hover:bg-surface-3")}>{o}</button>
        ))}
        {pick !== null && <p className={clsx("text-[12.5px]", correct ? "text-up" : "text-down")}>{correct ? "Correct — lesson complete." : "Not quite. Try again."}</p>}
        {done && pick === null && <p className="text-[12.5px] text-up">Completed.</p>}
      </div>
    </div>
  );
}

function Sandbox() {
  const [kp, setKp] = useState<Keypair | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [tokens, setTokens] = useState<PracticeToken[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<{ label: string; sig: string } | null>(null);
  const [f, setF] = useState({ name: "Class Coin", symbol: "CLASS", supply: "1000000" });
  const [copied, setCopied] = useState(false);
  const addr = kp?.publicKey.toBase58() ?? "";

  const refresh = useCallback(async (k?: Keypair) => {
    const key = k ?? kp;
    if (!key) return;
    setTokens(practiceTokens());
    setSol(await balanceSol(key.publicKey.toBase58()).catch(() => null));
  }, [kp]);
  useEffect(() => { practiceKey().then((k) => { setKp(k); void refresh(k); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label); setErr(null);
    try { const sig = await fn(); setLast({ label, sig }); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <Card className="lg:sticky lg:top-24" data-testid="sandbox">
      <CardHeader title={<span className="inline-flex items-center gap-2"><FlaskConical size={16} className="text-up" />Student sandbox</span>} sub="Solana devnet · test coins only" action={<Badge tone="up">Devnet</Badge>} />
      <div className="px-4 sm:px-5 pb-5 space-y-3">
        <div className="rounded-xl bg-surface-2 px-3 py-2.5 flex items-center gap-2.5">
          <Wallet size={16} className="text-muted" />
          <div className="min-w-0 flex-1"><div className="text-[12px] text-muted">Practice wallet (this browser)</div><div className="font-mono text-[12.5px] truncate" data-testid="sandbox-address">{addr || "…"}</div></div>
          <button aria-label="Copy address" onClick={() => { navigator.clipboard?.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="text-muted hover:text-fg">{copied ? <Check size={14} className="text-up" /> : <Copy size={14} />}</button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1"><div className="text-[12px] text-muted">Balance</div><div className="text-[22px] font-semibold num" data-testid="sandbox-balance">{sol === null ? "—" : `${sol.toFixed(3)} test SOL`}</div></div>
          <button onClick={() => refresh()} aria-label="Refresh" className="h-9 w-9 grid place-items-center rounded-full text-muted hover:bg-surface-2"><RefreshCw size={15} /></button>
          <Button disabled={!kp || !!busy} onClick={() => run("Airdrop", () => airdrop(addr))} data-testid="sandbox-airdrop">{busy === "Airdrop" ? <Loader2 size={15} className="animate-spin" /> : <Droplets size={15} />} Get 1 test SOL</Button>
        </div>
        <p className="text-[11.5px] text-faint">Faucet busy? Paste your address at <a className="underline" href="https://faucet.solana.com" target="_blank" rel="noopener noreferrer">faucet.solana.com</a>.</p>

        <div className="rounded-2xl border border-line p-3 space-y-2">
          <div className="text-[14px] font-semibold flex items-center gap-1.5"><Rocket size={15} className="text-ai" />Launch a practice token</div>
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <input value={f.name} maxLength={32} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} aria-label="Practice token name" className="no-ring h-10 rounded-lg bg-surface-2 px-3 text-[16px] sm:text-sm outline-none" />
            <input value={f.symbol} maxLength={10} onChange={(e) => setF((x) => ({ ...x, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))} aria-label="Practice token symbol" className="no-ring h-10 rounded-lg bg-surface-2 px-3 text-[16px] sm:text-sm outline-none" />
          </div>
          <input value={f.supply} onChange={(e) => setF((x) => ({ ...x, supply: e.target.value.replace(/\D/g, "") }))} aria-label="Practice token supply" inputMode="numeric" className="no-ring w-full h-10 rounded-lg bg-surface-2 px-3 text-[16px] sm:text-sm num outline-none" />
          <Button className="w-full" disabled={!kp || !!busy || !f.name.trim() || !f.symbol || !f.supply || (sol ?? 0) < 0.03} onClick={() => run("Launch", async () => (await launchPractice(kp!, { name: f.name.trim(), symbol: f.symbol, supply: BigInt(f.supply), decimals: 6, revokeMint: false })).sig)} data-testid="sandbox-launch">{busy === "Launch" ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} Launch on devnet</Button>
          {(sol ?? 0) < 0.03 && <p className="text-[11.5px] text-muted">Needs about 0.03 test SOL — get some above first.</p>}
        </div>

        {tokens.length > 0 && (
          <div className="space-y-2" data-testid="sandbox-tokens">
            <div className="text-[13px] font-semibold">Your practice tokens</div>
            {tokens.slice(0, 5).map((t) => <PracticeRow key={t.mint} t={t} kp={kp!} busy={busy} run={run} />)}
          </div>
        )}

        {last && <Notice title={`${last.label} confirmed`}><a className="underline inline-flex items-center gap-1" href={devnetExplorer("tx", last.sig)} target="_blank" rel="noopener noreferrer">View on Solana Explorer (devnet) <ExternalLink size={11} /></a></Notice>}
        {err && <Notice tone="down">{err}</Notice>}
        <div className="flex items-start gap-1.5 text-[11.5px] text-faint"><ShieldAlert size={13} className="shrink-0 mt-0.5" /><span>This practice key lives only in this browser and only works on devnet. Never send real funds to it. <button className="underline" onClick={async () => { await resetPracticeKey(); const k = await practiceKey(); setKp(k); setLast(null); await refresh(k); }}>Start over with a new key</button></span></div>
      </div>
    </Card>
  );
}

function PracticeRow({ t, kp, busy, run }: { t: PracticeToken; kp: Keypair; busy: string | null; run: (label: string, fn: () => Promise<string>) => Promise<void> }) {
  const [bal, setBal] = useState<bigint | null>(null);
  useEffect(() => { tokenBalanceRaw(kp.publicKey.toBase58(), t.mint).then(setBal).catch(() => setBal(null)); }, [kp, t.mint, busy]);
  const ui = bal === null ? "…" : (Number(bal) / 10 ** t.decimals).toLocaleString();
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-[14px] flex-1">{t.symbol} <span className="text-muted font-normal text-[12px]">· {ui}</span></span>
        <a href={devnetExplorer("address", t.mint)} target="_blank" rel="noopener noreferrer" className="text-[12px] text-brand inline-flex items-center gap-1">Explorer<ExternalLink size={11} /></a>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!!busy || !bal} onClick={() => run("Burn", () => managePractice(kp, t, { kind: "burn", amountRaw: bal! / BigInt(10) }))} data-testid="sandbox-burn"><Flame size={13} /> Burn 10%</Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("Revoke mint authority", () => managePractice(kp, t, { kind: "revokeMint" }))}><ShieldOff size={13} /> Revoke mint</Button>
      </div>
    </div>
  );
}

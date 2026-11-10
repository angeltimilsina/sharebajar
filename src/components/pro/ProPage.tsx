"use client";
import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Check, Crown, Link2, Loader2, Minus, ShieldCheck, Sparkles } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import { useProfile } from "@/hooks/useProfile";
import { Button, Card, CardHeader, Notice } from "../ui/primitives";
import { AgentButton } from "../ai/AgentButton";
import { shortAddress } from "@/lib/format";
import { buildProPayment, sendAndConfirm } from "@/lib/pro/checkout";

const ROWS: [string, string | boolean, string | boolean][] = [
  ["Bajar Wallet with post-quantum sign-in", true, true],
  ["Connect other wallets with a connection token", true, true],
  ["Investment agent", "Standard", "Advanced"],
  ["Agent reads Bajar Wallet and connected wallets live", false, true],
  ["Risk report: volatility, drawdown, concentration", false, true],
  ["Step-by-step trade plans, one tap to open in Trade", false, true],
  ["Agent messages", "8 per 10 min", "30 per 10 min"],
  ["Launchpad on Solana, Ethereum, Base, BNB + token controls", true, true],
];

export function ProPage() {
  const p = useProfile();
  const price = p.pricing?.priceUsdc ?? 19;
  const days = p.pricing?.periodDays ?? 30;
  return (
    <div className="space-y-5" data-testid="pro-page">
      <span data-app-page hidden />
      <div className="rounded-[28px] p-6 sm:p-8 text-white" style={{ background: "linear-gradient(135deg,#5e2bd8,#0a84ff)" }}>
        <div className="flex items-center gap-2 text-[13px] font-semibold opacity-90"><Crown size={16} /> Bajar Pro</div>
        <h1 className="mt-2 text-[30px] sm:text-[40px] leading-tight text-white">An investment agent that knows your wallet.</h1>
        <p className="mt-2 text-[15px] opacity-90 max-w-xl">Pro adds an advanced agent that reads your Bajar Wallet and the wallets connected to it, measures risk and drafts trade plans you approve yourself.</p>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-2"><span className="text-[34px] font-semibold num whitespace-nowrap">{price} USDC</span><span className="opacity-85 text-[14px]">/ {days} days · paid on Solana · no auto-renew</span></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <Card>
          <CardHeader title="Free vs Pro" />
          <div className="px-4 sm:px-5 pb-4">
            <div className="grid grid-cols-[1fr_80px_80px] sm:grid-cols-[1fr_120px_120px] text-[12px] text-muted pb-2 border-b border-line"><span /> <span className="text-center">Free</span><span className="text-center text-brand font-semibold">Pro</span></div>
            {ROWS.map(([label, free, pro]) => (
              <div key={label} className="grid grid-cols-[1fr_80px_80px] sm:grid-cols-[1fr_120px_120px] items-center py-2.5 border-b border-line/60 last:border-0 text-[13.5px]">
                <span>{label}</span>
                <Cell v={free} /><Cell v={pro} pro />
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
          <Card className="p-4 sm:p-5" data-testid="pro-agent">
            <h2 className="text-[17px] font-semibold">Investment agent</h2>
            <p className="text-[13px] text-muted mt-1 mb-3">{p.isPro ? "Pro: reads your wallet live, runs a risk report and drafts trade steps you approve." : "Ask about your portfolio with live market data. Pro adds live wallet reads, risk reports and trade plans."}</p>
            <AgentButton />
          </Card>
          <WalletsCard />
          <Checkout />
        </div>
      </div>
      <p className="text-[12px] text-faint">Pro is analysis and convenience. The agent never moves funds: every trade or transfer is opened for you to review and approve in your own wallet. Not financial advice.</p>
    </div>
  );
}

function Cell({ v, pro }: { v: string | boolean; pro?: boolean }) {
  if (v === true) return <span className="grid place-items-center"><Check size={16} className={pro ? "text-brand" : "text-up"} /></span>;
  if (v === false) return <span className="grid place-items-center"><Minus size={16} className="text-faint" /></span>;
  return <span className={clsx("text-center num", pro && "font-semibold text-brand")}>{v}</span>;
}

/** Wallets live in Bajar Wallet; Pro uses its sign-in. */
function WalletsCard() {
  const p = useProfile();
  const count = p.profile?.wallets.length ?? 0;
  return (
    <Card className="p-4 sm:p-5" data-testid="pro-wallets">
      <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-brand" /><h2 className="text-[17px] font-semibold">Your wallet</h2></div>
      <p className="text-[13px] text-muted mt-1">{p.signedIn && p.profile ? `Signed in with Bajar Wallet · ${Math.max(0, count - 1)} connected wallet${count === 2 ? "" : "s"}.` : "Pro works with Bajar Wallet. Create or unlock it and sign in once; connect other wallets to it with a connection token."}</p>
      <Link href="/wallet#connections" className="mt-3 inline-flex"><Button variant="outline"><Link2 size={15} /> Open Bajar Wallet</Button></Link>
    </Card>
  );
}

function Checkout() {
  const { wallet, session, solana } = useWallet();
  const p = useProfile();
  const [step, setStep] = useState<"idle" | "review" | "paying" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const price = p.pricing?.priceUsdc ?? 19;
  const recipient = p.pricing?.recipient ?? null;
  const norm = (a: string) => (a.startsWith("0x") ? a.toLowerCase() : a);
  const linked = wallet && p.profile?.wallets.some((w) => w.address === norm(wallet.address));
  const ready = !!session && !!p.profile && wallet?.chainType === "solana" && linked && !!recipient;

  const pay = async () => {
    const prov = solana();
    if (!wallet || !recipient || !prov?.signTransaction) { setErr("This wallet can't sign transactions."); return; }
    setErr(null); setStep("paying");
    try {
      const tx = await buildProPayment(wallet.address, recipient, price);
      const signed = await prov.signTransaction(tx);
      const sig = await sendAndConfirm(signed.serialize());
      let res: { ok?: boolean; error?: string } = {};
      for (let i = 0; i < 6; i++) {
        const r = await fetch("/api/pro/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature: sig }) });
        res = await r.json();
        if (r.status !== 404) break;
        await new Promise((x) => setTimeout(x, 3000));
      }
      if (!res.ok) throw new Error(`${res.error ?? "Activation failed"} Your payment signature: ${sig}`);
      await p.refresh();
      setStep("done");
    } catch (e) {
      const m = (e as Error).message;
      setErr(/reject|denied|cancel/i.test(m) ? "You rejected the payment. Nothing was charged." : m);
      setStep("idle");
    }
  };

  return (
    <Card className="p-4 sm:p-5" data-testid="pro-checkout">
      <div className="flex items-center gap-2"><Sparkles size={16} className="text-ai" /><h2 className="text-[17px] font-semibold">{p.isPro ? "Extend Pro" : "Get Pro"}</h2></div>
      {p.isPro && p.profile?.plan.until && <p className="text-[13px] text-muted mt-1">Pro until {new Date(p.profile.plan.until).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}. Paying again adds {p.pricing?.periodDays ?? 30} days.</p>}
      {step === "done" ? (
        <Notice title="Welcome to Pro" className="mt-3">Your advanced agent is ready. <Link href="/intelligence?agent=portfolio" className="underline">Open the investment agent</Link></Notice>
      ) : (
        <>
          <ul className="mt-3 rounded-xl bg-surface-2 p-3 text-[13px] space-y-1">
            <li className="flex justify-between"><span className="text-muted">Price</span><span className="num font-medium">{price} USDC</span></li>
            <li className="flex justify-between"><span className="text-muted">Period</span><span>{p.pricing?.periodDays ?? 30} days, no auto-renew</span></li>
            <li className="flex justify-between"><span className="text-muted">Network</span><span>Solana (USDC)</span></li>
            <li className="flex justify-between"><span className="text-muted">Paid to</span><span className="num">{recipient ? `Bajar treasury ${shortAddress(recipient)}` : "—"}</span></li>
          </ul>
          {!recipient && <Notice className="mt-3" title="Checkout opens soon">Pro payments go only to Bajar&apos;s verified, multisig-controlled treasury, which isn&apos;t active yet. You can set up your profile and link wallets now.</Notice>}
          {recipient && !ready && <p className="mt-3 text-[12.5px] text-muted">{!session ? "Sign in with Bajar Wallet first." : wallet?.chainType !== "solana" ? "Connect Bajar Wallet or a connected Solana wallet with USDC to pay." : "Pay from Bajar Wallet or a wallet connected to it."}</p>}
          {step === "review" && (
            <Notice tone="warn" className="mt-3" title="Approve one payment in your wallet">You&apos;ll send exactly {price} USDC from {shortAddress(wallet!.address)} to Bajar&apos;s treasury {shortAddress(recipient!)}, plus a small Solana network fee. It&apos;s checked on-chain before Pro turns on.</Notice>
          )}
          {err && <Notice tone="down" className="mt-3">{err}</Notice>}
          <div className="mt-3 flex gap-2">
            {step === "review" && <Button variant="outline" onClick={() => setStep("idle")}>Back</Button>}
            <Button className="flex-1 h-11" disabled={!ready || step === "paying"} onClick={step === "review" ? pay : () => setStep("review")} data-testid="pro-pay">
              {step === "paying" ? <><Loader2 size={15} className="animate-spin" /> Confirming…</> : step === "review" ? `Pay ${price} USDC` : `Continue with ${price} USDC`}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

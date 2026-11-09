"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, ChevronDown, Settings2, Loader2, AlertTriangle, CheckCircle2, XCircle, ExternalLink, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { useWallet } from "../wallet/WalletProvider";
import { Badge, Button, Card, Notice, Tabs } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import { TokenIcon } from "../ui/TokenIcon";
import { COMMON, TokenPicker, type SwapToken } from "./TokenPicker";
import { formatNumber, formatUsd } from "@/lib/format";
import { assertSafeSolanaSwap } from "@/lib/wallet/txguard";
import { PHANTOM_MOBILE, phantomSignTransaction } from "@/lib/wallet/phantomLink";
import { getSolBalance, getSplHoldings, getSignatureStatus, simulateBase64, SOLANA_RPC, SOL_MINT, type SimResult } from "@/lib/wallet/rpc";
import { solanaSignAndSend, solanaSignOnly } from "@/lib/wallet/solana";
import { addActivity } from "@/lib/activity";
import Link from "next/link";

type FeeDisclosure =
  | { applied: true; bps: number; mode: string; provider: string; token: string | null; symbol: string | null; decimals: number | null; estimatedAmount: string | null; recipient: string; providerShareBps: number; isTest: boolean; note: string }
  | { applied: false; reason: string };

interface Quote {
  provider: string; route: "build" | "order";
  inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct: number; slippageBps: number;
  routeLabels: string[]; fee: FeeDisclosure; jupiterFee: { bps: number; mint: string | null } | null; intentToken: string | null;
}
interface Prepared { route: "build" | "order"; transaction: string; requestId: string | null; lastValidBlockHeight: number | null; unitsConsumed?: number | null; quote: Quote; builtFor?: string }

const toBase = (v: string, decimals: number): string | null => {
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  const [i, f = ""] = v.split(".");
  const s = (i || "0") + f.padEnd(decimals, "0").slice(0, decimals);
  const n = s.replace(/^0+/, "");
  return n === "" ? null : n;
};
const fromBase = (v: string, decimals: number) => Number(v) / 10 ** decimals;
const QUOTE_REFRESH = 15;

type Step = "idle" | "building" | "simulating" | "ready" | "signing" | "submitted" | "confirmed" | "failed";

/**
 * Solana execution panel (Jupiter). Used for both execution modes:
 *  - variant "swap":  any token → the asset (destination prefilled, optionally locked)
 *  - variant "trade": buy or sell the asset against a quote token (market order)
 * Quotes work without a wallet; the wallet is requested only to execute.
 */
export function SwapPanel({ defaultOutput, side, variant = "swap", lockAsset = false, embedded = false, assetHref }: {
  defaultOutput?: string; side?: "buy" | "sell"; variant?: "swap" | "trade"; lockAsset?: boolean; embedded?: boolean; assetHref?: string;
}) {
  const { wallet, openModal, solana } = useWallet();
  const [mode, setMode] = useState<"swap" | "limit">("swap");
  const [input, setInput] = useState<SwapToken>(COMMON[0]);
  const [output, setOutput] = useState<SwapToken>(COMMON[1]);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [customSlip, setCustomSlip] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [picker, setPicker] = useState<"in" | "out" | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteAt, setQuoteAt] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [balances, setBalances] = useState<Record<string, number> | null>(null);
  const [balErr, setBalErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // review / execution
  const [review, setReview] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [tx, setTx] = useState<Prepared | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [execErr, setExecErr] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [ackImpact, setAckImpact] = useState(false);

  // Preset output token from the URL (?output=<mint>&side=sell)
  useEffect(() => {
    if (!defaultOutput) return;
    const known = COMMON.find((t) => t.address === defaultOutput);
    const quoteTok = COMMON.find((x) => x.symbol === "USDC") ?? COMMON[0];
    // Trade quotes against USDC; Swap starts from SOL. Never pair a token with itself.
    const payWith = (t: SwapToken) => {
      const pref = variant === "trade" ? quoteTok : COMMON[0];
      const alt = variant === "trade" ? COMMON[0] : quoteTok;
      return t.address === pref.address ? alt : pref;
    };
    const apply = (t: SwapToken) => { if (side === "sell") { setInput(t); setOutput(payWith(t)); } else { setOutput(t); setInput(payWith(t)); } setQuote(null); };
    if (known) { apply(known); return; }
    fetch(`/api/swap/tokens?q=${defaultOutput}`).then((r) => r.json()).then((b) => {
      const t = b.data?.find((x: SwapToken) => x.address === defaultOutput);
      if (t) apply(t);
      else setQuoteErr("This token is not currently tradable through Jupiter.");
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOutput, side]);

  // USD prices
  useEffect(() => {
    const ids = [input.address, output.address].join(",");
    const load = () => fetch(`/api/swap/prices?ids=${ids}`).then((r) => r.json()).then((b) => {
      if (!b.data) return;
      setPrices((p) => ({ ...p, ...Object.fromEntries(Object.entries(b.data as Record<string, { usdPrice: number }>).map(([k, v]) => [k, v.usdPrice])) }));
    }).catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [input.address, output.address]);

  // Balances (Solana RPC)
  const loadBalances = useCallback(async () => {
    if (wallet?.chainType !== "solana") { setBalances(null); return; }
    try {
      const [sol, spl] = await Promise.all([getSolBalance(wallet.address), getSplHoldings(wallet.address)]);
      const b: Record<string, number> = { [SOL_MINT]: sol };
      for (const h of spl) b[h.mint] = (b[h.mint] ?? 0) + h.amount;
      setBalances(b);
      setBalErr(null);
    } catch (e) { setBalErr((e as Error).message); }
  }, [wallet]);
  useEffect(() => { loadBalances(); }, [loadBalances]);

  // Quotes: debounce on input, refresh every 15s
  const baseAmount = toBase(amount, input.decimals);
  const reqId = useRef(0);
  const fetchQuote = useCallback(async () => {
    if (!baseAmount || mode !== "swap") { setQuote(null); setQuoteErr(null); return; }
    const id = ++reqId.current;
    setQuoting(true);
    try {
      const r = await fetch(`/api/swap/quote?inputMint=${input.address}&outputMint=${output.address}&amount=${baseAmount}&slippageBps=${slippageBps}${wallet?.chainType === "solana" ? `&taker=${wallet.address}` : ""}`);
      const b = await r.json();
      if (id !== reqId.current) return;
      if (!r.ok) throw new Error(b.error ?? "Quote failed");
      setQuote(b.data);
      setQuoteAt(Date.now());
      setQuoteErr(null);
    } catch (e) {
      if (id !== reqId.current) return;
      setQuote(null);
      const m = (e as Error).message;
      setQuoteErr(/not tradable|TOKEN_NOT_TRADABLE/i.test(m) ? "This token is not tradable via Jupiter routing." : /No routes|COULD_NOT_FIND/i.test(m) ? "No route found for this pair and amount." : m);
    } finally { if (id === reqId.current) setQuoting(false); }
  }, [baseAmount, input.address, output.address, slippageBps, mode, wallet]);
  useEffect(() => { const t = setTimeout(fetchQuote, 400); return () => clearTimeout(t); }, [fetchQuote]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const age = quoteAt ? Math.floor((Date.now() - quoteAt) / 1000) : 0;
  useEffect(() => { if (quote && !review && age >= QUOTE_REFRESH) fetchQuote(); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const out = quote ? fromBase(quote.outAmount, output.decimals) : null;
  const minOut = quote ? fromBase(quote.otherAmountThreshold, output.decimals) : null;
  const impact = quote ? Math.abs(Number(quote.priceImpactPct)) * 100 : 0;
  const inUsd = prices[input.address] && amount ? Number(amount) * prices[input.address] : null;
  const outUsd = prices[output.address] && out !== null ? out * prices[output.address] : null;
  const route = useMemo(() => quote?.routeLabels ?? [], [quote]);
  const feeAmt = (f: FeeDisclosure | undefined) => (f?.applied && f.estimatedAmount && f.decimals !== null ? `≈ ${formatNumber(Number(f.estimatedAmount) / 10 ** f.decimals, 6)} ${f.symbol ?? ""}` : "");
  const inBal = balances?.[input.address];
  const insufficient = inBal !== undefined && Number(amount) > inBal;
  const highImpact = impact > 5;

  const flip = () => { setInput(output); setOutput(input); setAmount(out ? String(Number(out.toFixed(Math.min(6, output.decimals)))) : ""); setQuote(null); };

  /* ----- execution ----- */
  const startReview = async () => {
    if (!wallet || wallet.chainType !== "solana" || !quote) return;
    setReview(true); setStep("building"); setExecErr(null); setSim(null); setSig(null); setTx(null); setAckImpact(false);
    try {
      const r = await fetch("/api/swap/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputMint: input.address, outputMint: output.address, amount: baseAmount, slippageBps, userPublicKey: wallet.address }) });
      const b = (await r.json()) as Prepared & { error?: string };
      if (!r.ok) throw new Error(b.error ?? "Could not build transaction");
      // Verify before anything reaches the wallet: paid by you, grants no one control of your tokens.
      await assertSafeSolanaSwap(b.transaction, wallet.address);
      setTx({ ...b, builtFor: wallet.address });
      setQuote(b.quote);
      setStep("simulating");
      try {
        const s = await simulateBase64(b.transaction);
        setSim(s);
        if (s.err) { setStep("failed"); setExecErr(`Simulation failed: ${JSON.stringify(s.err)}. The swap would likely fail on-chain — no transaction was sent.`); return; }
      } catch (e) {
        // Simulation is a safety check; if the RPC refuses, tell the user clearly.
        setSim(null);
        setExecErr(`Could not simulate (${(e as Error).message}). You can still review and approve in your wallet, which runs its own simulation.`);
      }
      setStep("ready");
    } catch (e) { setStep("failed"); setExecErr((e as Error).message); }
  };

  const confirm = async () => {
    const p = solana();
    if (!p || !tx) return;
    // The wallet account must still be the one the transaction was built for.
    if (!wallet || wallet.address !== tx.builtFor) { setStep("failed"); setExecErr("Your wallet account changed since this swap was prepared. Review it again."); return; }
    setStep("signing"); setExecErr(null);
    if (wallet.walletId === PHANTOM_MOBILE) {
      // Phone browser + Phantom app: Phantom signs and sends us back here, where the
      // signed transaction is re-verified and submitted (see WalletProvider).
      const summary = variant === "trade" ? `${side === "sell" ? "Sold" : "Bought"} ${side === "sell" ? input.symbol : output.symbol} · ${amount} ${input.symbol}` : `Swapped ${amount} ${input.symbol} → ${output.symbol}`;
      try { phantomSignTransaction(tx.transaction, { kind: "swap", route: tx.route, requestId: tx.requestId, intentToken: tx.quote.intentToken ?? null, summary, assetHref, activityKind: variant === "trade" ? "trade" : "swap" }); }
      catch (e) { setStep("failed"); setExecErr((e as Error).message); }
      return;
    }
    try {
      let signature: string;
      if (tx.route === "order") {
        // Jupiter /order: sign only, Jupiter lands it via /execute.
        const signed = await solanaSignOnly(p, tx.transaction);
        const r = await fetch("/api/swap/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedTransaction: signed, requestId: tx.requestId, intentToken: tx.quote.intentToken }) });
        const b = await r.json();
        if (!b.signature) throw new Error(b.error ?? `Execution failed (code ${b.code ?? "?"})`);
        signature = b.signature;
      } else {
        signature = await solanaSignAndSend(p, tx.transaction, SOLANA_RPC);
        // Report the hash so the treasury indexer can verify the fee on-chain.
        if (tx.quote.intentToken) fetch("/api/treasury/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intentToken: tx.quote.intentToken, txHash: signature }) }).catch(() => {});
      }
      setSig(signature);
      setStep("submitted");
      addActivity({ chain: "solana", hash: signature, kind: variant === "trade" ? "trade" : "swap", summary: variant === "trade" ? `${side === "sell" ? "Sold" : "Bought"} ${side === "sell" ? input.symbol : output.symbol} · ${amount} ${input.symbol}` : `Swapped ${amount} ${input.symbol} → ${output.symbol}`, wallet: wallet?.address, assetHref });
      const started = Date.now();
      while (Date.now() - started < 90_000) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const st = await getSignatureStatus(signature);
          if (st?.err) { setStep("failed"); setExecErr(`Transaction failed on-chain: ${JSON.stringify(st.err)}`); return; }
          if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") { setStep("confirmed"); setAmount(""); setQuote(null); loadBalances(); return; }
        } catch { /* keep polling */ }
      }
      setExecErr("Still waiting for confirmation. Check the explorer for the final status.");
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      setStep("failed");
      setExecErr(/reject|denied|cancel/i.test(m) ? "You rejected the transaction in your wallet. Nothing was sent." : m);
    }
  };

  const slipOptions = [10, 50, 100, 300];
  const cta = (() => {
    const verb = variant === "trade" ? (side === "sell" ? `Sell ${input.symbol}` : `Buy ${output.symbol}`) : "swap";
    if (mode === "limit") return <Button size="lg" className="w-full" disabled>Limit orders coming soon</Button>;
    // Quote first; the wallet is only needed to execute.
    if (!baseAmount) return <Button size="lg" className="w-full" disabled>Enter an amount</Button>;
    if (quoting && !quote) return <Button size="lg" className="w-full" disabled><Loader2 size={16} className="animate-spin" /> Fetching best route…</Button>;
    if (!quote) return <Button size="lg" className="w-full" disabled>{quoteErr ? "No route" : "Get quote"}</Button>;
    if (!wallet) return <Button size="lg" className="w-full" onClick={openModal}>Connect wallet to {variant === "trade" ? verb.replace(/^(Buy|Sell)/, (m) => m.toLowerCase()) : "swap"}</Button>;
    if (wallet.chainType !== "solana") return <Button size="lg" className="w-full" onClick={openModal}>Connect a Solana wallet to {variant === "trade" ? verb.replace(/^(Buy|Sell)/, (m) => m.toLowerCase()) : "swap"}</Button>;
    if (insufficient) return <Button size="lg" className="w-full" disabled>Insufficient {input.symbol} balance</Button>;
    return <Button size="lg" className={clsx("w-full", highImpact && "bg-warn hover:bg-warn")} onClick={startReview}>{highImpact ? `Review ${variant === "trade" ? "order" : "swap"} (high impact)` : variant === "trade" ? `Review · ${verb}` : "Review swap"}</Button>;
  })();

  return (
    <Card className={clsx("p-4", embedded && "!border-0 !shadow-none !bg-transparent p-0")}>
      <div className="flex items-center justify-between mb-3">
        {embedded ? <span className="text-xs text-muted">{variant === "trade" ? "Market order" : "Best route"}</span> : <Tabs size="sm" tabs={[{ id: "swap", label: "Swap" }, { id: "limit", label: <span>Limit <span className="text-[9px] text-ai">SOON</span></span> }]} value={mode} onChange={setMode} />}
        <div className="flex items-center gap-2">
          <Badge tone="brand">Solana · Jupiter</Badge>
          <button onClick={() => setShowSettings((s) => !s)} aria-label="Slippage settings" className="h-8 px-2 rounded-lg text-xs text-muted hover:text-fg hover:bg-surface-2 inline-flex items-center gap-1"><Settings2 size={14} /> {(slippageBps / 100).toFixed(slippageBps < 100 ? 2 : 1)}%</button>
        </div>
      </div>
      {showSettings && (
        <div className="mb-3 rounded-xl border border-line bg-surface-2 p-3">
          <div className="text-xs text-muted mb-2">Max slippage</div>
          <div className="flex gap-1.5">
            {slipOptions.map((b) => <button key={b} onClick={() => { setSlippageBps(b); setCustomSlip(""); }} className={clsx("h-8 px-3 rounded-lg text-xs font-semibold num", slippageBps === b && !customSlip ? "bg-brand-soft text-brand border border-brand/40" : "bg-surface-3 text-muted")}>{b / 100}%</button>)}
            <input value={customSlip} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ""); setCustomSlip(v); const n = Math.round(Number(v) * 100); if (n >= 1 && n <= 5000) setSlippageBps(n); }} placeholder="Custom %" className="h-8 w-24 rounded-lg bg-surface-3 px-2 text-xs outline-none num" />
          </div>
          {slippageBps > 300 && <div className="text-[11px] text-warn mt-2">High slippage increases the risk of a worse execution price (and MEV sandwiching).</div>}
        </div>
      )}
      {mode === "limit" ? (
        <Notice tone="ai" title="Limit orders are not yet available">Limit orders will be routed through on-chain trigger order infrastructure once integrated. Use market swaps in the meantime.</Notice>
      ) : (
        <>
          {/* input */}
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex justify-between text-xs text-muted mb-1.5">
              <span>You pay</span>
              {wallet?.chainType === "solana" && (
                <span className="num">{balErr ? <span title={balErr} className="text-warn">Balance unavailable</span> : inBal !== undefined ? <>Balance {formatNumber(inBal, 4)} <button className="text-brand font-semibold ml-1" onClick={() => setAmount(String(input.address === SOL_MINT ? Math.max(0, inBal - 0.01) : inBal))}>MAX</button></> : "…"}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))} placeholder="0.00" className="flex-1 min-w-0 bg-transparent text-2xl font-semibold outline-none num" aria-label="Amount to pay" />
              <button onClick={() => setPicker("in")} disabled={lockAsset && (variant === "trade" ? side === "sell" : false)} className="disabled:opacity-100 disabled:cursor-default h-10 shrink-0 rounded-xl bg-surface-3 border border-line px-2.5 inline-flex items-center gap-1.5 font-semibold text-sm"><TokenIcon src={input.icon} symbol={input.symbol} size={22} />{input.symbol}<ChevronDown size={14} /></button>
            </div>
            <div className="text-xs text-muted num mt-1 h-4">{inUsd !== null ? formatUsd(inUsd) : ""}</div>
          </div>
          <div className="flex justify-center -my-2.5 relative z-10">
            <button onClick={flip} disabled={lockAsset} aria-label="Flip tokens" className="disabled:opacity-40 h-9 w-9 rounded-xl border border-line bg-surface grid place-items-center hover:bg-surface-2"><ArrowDownUp size={15} /></button>
          </div>
          {/* output */}
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex justify-between text-xs text-muted mb-1.5"><span>You receive (estimated)</span>{balances?.[output.address] !== undefined && <span className="num">Balance {formatNumber(balances[output.address], 4)}</span>}</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 text-2xl font-semibold num truncate">{quoting && !quote ? <span className="text-faint">…</span> : out !== null ? formatNumber(out, 6) : <span className="text-faint">0.00</span>}</div>
              <button onClick={() => setPicker("out")} disabled={lockAsset && (variant === "trade" ? side !== "sell" : true)} className="disabled:opacity-100 disabled:cursor-default h-10 shrink-0 rounded-xl bg-surface-3 border border-line px-2.5 inline-flex items-center gap-1.5 font-semibold text-sm"><TokenIcon src={output.icon} symbol={output.symbol} size={22} />{output.symbol}<ChevronDown size={14} /></button>
            </div>
            <div className="text-xs text-muted num mt-1 h-4">{outUsd !== null ? formatUsd(outUsd) : ""}{inUsd && outUsd ? <span className={outUsd / inUsd < 0.97 ? "text-warn" : ""}> ({(((outUsd - inUsd) / inUsd) * 100).toFixed(2)}%)</span> : null}</div>
          </div>
          {quoteErr && <div className="mt-2 text-xs text-down flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{quoteErr}</div>}
          {quote && (
            <div className="mt-3 space-y-1.5 text-xs">
              <Row k="Rate" v={out && Number(amount) ? `1 ${input.symbol} ≈ ${formatNumber(out / Number(amount), 6)} ${output.symbol}` : "—"} />
              <Row k="Price impact" v={<span className={impact > 5 ? "text-down" : impact > 1 ? "text-warn" : "text-up"}>{impact < 0.01 ? "< 0.01%" : `${impact.toFixed(2)}%`}</span>} />
              <Row k="Platform fee" v={quote.fee.applied ? <span title={quote.fee.note}>{(quote.fee.bps / 100).toFixed(2)}% {feeAmt(quote.fee)}{quote.fee.isTest && <Badge tone="warn" className="ml-1">TEST</Badge>}</span> : <span className="text-muted">None</span>} />
              {quote.fee.applied ? <div className="text-[11px] text-faint">{quote.fee.note}</div> : <div className="text-[11px] text-faint">{quote.fee.reason}</div>}
              {quote.jupiterFee && <Row k="Jupiter fee" v={`${(quote.jupiterFee.bps / 100).toFixed(2)}%`} />}
              <Row k={`Minimum received (${slippageBps / 100}% slippage)`} v={`${formatNumber(minOut, 6)} ${output.symbol}`} />
              <Row k="Route" v={<span className="text-right">{route.join(" → ") || "—"}</span>} />
              <Row k="Network fee" v="≈ 0.000005 SOL + priority fee" />
              <div className="flex justify-between text-faint pt-1"><span>Jupiter Swap V2 ({quote.route === "order" ? "/order" : "/build"}) · refreshes in {Math.max(0, QUOTE_REFRESH - age)}s</span>{quoting && <Loader2 size={12} className="animate-spin" />}</div>
            </div>
          )}
          <div className="mt-4">{cta}</div>
          <p className="mt-3 text-[11px] text-faint flex gap-1.5"><ShieldCheck size={13} className="shrink-0 text-brand" /> Non-custodial. You review and sign every transaction in your own wallet. Bajar never asks for seed phrases or private keys.</p>
        </>
      )}
      <TokenPicker open={picker !== null} onClose={() => setPicker(null)} onPick={(t) => { if (picker === "in") { if (t.address === output.address) setOutput(input); setInput(t); } else { if (t.address === input.address) setInput(output); setOutput(t); } setQuote(null); }} />

      <Modal open={review} onClose={() => step !== "signing" && setReview(false)} title="Review swap">
        <div className="px-5 pb-5 space-y-3 text-sm">
          <div className="rounded-xl border border-line bg-surface-2 p-3 space-y-2">
            <div className="flex justify-between"><span className="text-muted">Pay</span><span className="font-semibold num">{amount} {input.symbol}</span></div>
            <div className="flex justify-between"><span className="text-muted">Receive (est.)</span><span className="font-semibold num">{formatNumber(out, 6)} {output.symbol}</span></div>
            <div className="flex justify-between"><span className="text-muted">Minimum received</span><span className="num">{formatNumber(minOut, 6)} {output.symbol}</span></div>
            <div className="flex justify-between"><span className="text-muted">Price impact</span><span className={impact > 5 ? "text-down" : ""}>{impact.toFixed(2)}%</span></div>
            <div className="flex justify-between"><span className="text-muted">Platform fee</span><span className="num text-right">{quote?.fee.applied ? `${(quote.fee.bps / 100).toFixed(2)}% ${feeAmt(quote.fee)}` : "None"}</span></div>
            {quote?.fee.applied && quote.fee.providerShareBps > 0 && <div className="text-[11px] text-faint">Includes Jupiter&apos;s {quote.fee.providerShareBps / 100}% share of the referral fee.</div>}
            {tx && <div className="flex justify-between"><span className="text-muted">Network fee</span><span className="num">≈ 0.000005 SOL + priority fee{tx.unitsConsumed ? ` · ${tx.unitsConsumed.toLocaleString()} CU` : ""}</span></div>}
          </div>
          <ol className="space-y-1.5 text-xs">
            <StepRow label="Build transaction" state={step === "building" ? "active" : tx ? "done" : step === "failed" && !tx ? "error" : "todo"} />
            <StepRow label={sim ? `Simulate (${sim.unitsConsumed?.toLocaleString() ?? "?"} compute units)` : "Simulate transaction"} state={step === "simulating" ? "active" : sim && !sim.err ? "done" : sim?.err ? "error" : tx && step !== "building" ? "skipped" : "todo"} />
            <StepRow label="Approve in wallet" state={step === "signing" ? "active" : sig ? "done" : "todo"} />
            <StepRow label="Confirm on-chain" state={step === "submitted" ? "active" : step === "confirmed" ? "done" : step === "failed" && sig ? "error" : "todo"} />
          </ol>
          {highImpact && step === "ready" && (
            <label className="flex gap-2 text-xs text-warn"><input type="checkbox" checked={ackImpact} onChange={(e) => setAckImpact(e.target.checked)} className="accent-[var(--warn)]" /> I understand the price impact is {impact.toFixed(2)}% and I may receive much less value.</label>
          )}
          {execErr && <Notice tone={step === "failed" ? "down" : "warn"}>{execErr}</Notice>}
          {sig && <div className="flex flex-wrap gap-3 text-xs"><a href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noopener noreferrer" className="text-fg underline underline-offset-2 inline-flex items-center gap-1">View on Solscan <ExternalLink size={11} /></a><Link href="/portfolio" className="text-fg underline underline-offset-2">Track in Portfolio →</Link></div>}
          {step === "ready" && <Button size="lg" className="w-full" disabled={highImpact && !ackImpact} onClick={confirm}>Confirm in wallet</Button>}
          {step === "signing" && <Button size="lg" className="w-full" disabled><Loader2 size={16} className="animate-spin" /> Waiting for wallet approval…</Button>}
          {step === "confirmed" && <Button size="lg" className="w-full" onClick={() => setReview(false)}><CheckCircle2 size={16} /> Swap confirmed — Done</Button>}
          {step === "failed" && <Button size="lg" variant="subtle" className="w-full" onClick={() => { setReview(false); fetchQuote(); }}>Close & refresh quote</Button>}
        </div>
      </Modal>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-muted shrink-0">{k}</span><span className="num text-right">{v}</span></div>;
}

function StepRow({ label, state }: { label: string; state: "todo" | "active" | "done" | "error" | "skipped" }) {
  return (
    <li className="flex items-center gap-2">
      {state === "active" ? <Loader2 size={14} className="animate-spin text-brand" /> : state === "done" ? <CheckCircle2 size={14} className="text-up" /> : state === "error" ? <XCircle size={14} className="text-down" /> : <span className={clsx("h-3.5 w-3.5 rounded-full border", state === "skipped" ? "border-warn" : "border-line-strong")} />}
      <span className={state === "todo" ? "text-muted" : ""}>{label}{state === "skipped" && <span className="text-warn"> (skipped)</span>}</span>
    </li>
  );
}

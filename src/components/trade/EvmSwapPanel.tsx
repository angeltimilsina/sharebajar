"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownUp, Loader2, AlertTriangle, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import { Badge, Button, Card, Notice } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import { chainFromEvmId, getChain } from "@/lib/chains";
import { KNOWN_TOKENS, NATIVE_EVM, ZEROX_CHAINS } from "@/lib/treasury/tokens";
import { formatNumber } from "@/lib/format";
import type { Eip1193 } from "@/lib/wallet/evm";

interface Tok { token: string; symbol: string; decimals: number }
type FeeDisclosure = { applied: true; bps: number; symbol: string | null; decimals: number | null; estimatedAmount: string | null; note: string; isTest: boolean } | { applied: false; reason: string };
interface EvmQuote {
  liquidityAvailable: boolean; buyAmount: string; minBuyAmount: string; sellAmount: string; allowanceTarget: string | null;
  zeroExFee: { amount: string; token: string } | null; issues: { allowance: { actual: string; spender: string } | null; balance: { token: string; actual: string; expected: string } | null; simulationIncomplete: boolean };
  totalNetworkFee: string | null; transaction: { to: string; data: string; gas: string | null; gasPrice: string; value: string } | null; sources: string[]; fee: FeeDisclosure; intentToken: string | null; chainId: number;
}

const SUPPORTED = Object.keys(ZEROX_CHAINS);
const toBase = (v: string, d: number) => { if (!/^\d*\.?\d*$/.test(v) || !v || v === ".") return null; const [i, f = ""] = v.split("."); const n = (i || "0") + f.padEnd(d, "0").slice(0, d); return n.replace(/^0+/, "") || null; };
const hex = (v: string | bigint) => `0x${BigInt(v).toString(16)}`;
const approveData = (spender: string, amount: string) => `0x095ea7b3${spender.toLowerCase().replace(/^0x/, "").padStart(64, "0")}${BigInt(amount).toString(16).padStart(64, "0")}`;

async function waitReceipt(p: Eip1193, hash: string, timeoutMs = 180_000): Promise<{ status: string } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = (await p.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null)) as { status: string } | null;
    if (r) return r;
    await new Promise((res) => setTimeout(res, 2500));
  }
  return null;
}

export function EvmSwapPanel() {
  const { wallet, openModal, evm } = useWallet();
  const chain = wallet?.chainType === "evm" ? chainFromEvmId(wallet.chainId ?? 0) : undefined;
  const chainId = chain && SUPPORTED.includes(chain.id) ? chain.id : null;
  const tokens: Tok[] = chainId ? [{ token: NATIVE_EVM, symbol: getChain(chainId)!.nativeSymbol, decimals: 18 }, ...KNOWN_TOKENS[chainId]] : [];
  const [sell, setSell] = useState<Tok | null>(null);
  const [buy, setBuy] = useState<Tok | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<EvmQuote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState(false);
  const [step, setStep] = useState<"idle" | "approving" | "simulating" | "ready" | "signing" | "pending" | "done" | "failed">("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [simNote, setSimNote] = useState<string | null>(null);
  const req = useRef(0);

  useEffect(() => {
    if (!chainId) return;
    const list = [{ token: NATIVE_EVM, symbol: getChain(chainId)!.nativeSymbol, decimals: 18 }, ...KNOWN_TOKENS[chainId]];
    setSell(list.find((t) => t.symbol === "USDC") ?? list[1]);
    setBuy(list[0]);
    setQuote(null);
  }, [chainId]);

  const base = sell ? toBase(amount, sell.decimals) : null;
  const fetchQuote = useCallback(async () => {
    if (!chainId || !sell || !buy || !base || !wallet) { setQuote(null); return; }
    const id = ++req.current;
    setLoading(true);
    try {
      const r = await fetch(`/api/swap/evm?chain=${chainId}&sellToken=${sell.token}&buyToken=${buy.token}&sellAmount=${base}&taker=${wallet.address}&slippageBps=100`);
      const b = await r.json();
      if (id !== req.current) return;
      if (!r.ok) throw new Error(b.error);
      if (!b.data.liquidityAvailable) throw new Error("No liquidity for this pair.");
      setQuote(b.data); setErr(null);
    } catch (e) { if (id === req.current) { setQuote(null); setErr((e as Error).message); } }
    finally { if (id === req.current) setLoading(false); }
  }, [chainId, sell, buy, base, wallet]);
  useEffect(() => { const t = setTimeout(fetchQuote, 450); return () => clearTimeout(t); }, [fetchQuote]);

  if (!wallet || wallet.chainType !== "evm") {
    return <Card className="p-4 space-y-3"><div className="font-semibold">EVM swaps (0x)</div><p className="text-xs text-muted">Connect MetaMask or another EVM wallet to swap on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain or Avalanche.</p><Button className="w-full" onClick={openModal}>Connect EVM wallet</Button></Card>;
  }
  if (!chainId) {
    const switchTo = async (id: number) => { await evm()?.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(BigInt(id)) }] }).catch(() => {}); };
    return <Card className="p-4 space-y-3"><div className="font-semibold">EVM swaps (0x)</div><Notice tone="warn">Your wallet is on an unsupported network.</Notice><div className="flex flex-wrap gap-2">{SUPPORTED.map((c) => <Button key={c} size="sm" variant="subtle" onClick={() => switchTo(ZEROX_CHAINS[c])}>{getChain(c)?.name}</Button>)}</div></Card>;
  }

  const out = quote && buy ? Number(quote.buyAmount) / 10 ** buy.decimals : null;
  const minOut = quote && buy ? Number(quote.minBuyAmount) / 10 ** buy.decimals : null;
  const zx = quote?.zeroExFee && sell ? Number(quote.zeroExFee.amount) / 10 ** (quote.zeroExFee.token.toLowerCase() === buy?.token.toLowerCase() ? buy!.decimals : sell.decimals) : null;
  const insufficient = !!quote?.issues.balance;
  const fee = quote?.fee;
  const feeText = fee?.applied ? `${(fee.bps / 100).toFixed(2)}%${fee.estimatedAmount && fee.decimals !== null ? ` ≈ ${formatNumber(Number(fee.estimatedAmount) / 10 ** fee.decimals, 6)} ${fee.symbol}` : ""}` : "None";

  const execute = async () => {
    const p = evm();
    if (!p || !quote?.transaction || !sell) return;
    try {
      if (quote.issues.allowance) {
        setStep("approving");
        const h = (await p.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: sell.token, data: approveData(quote.issues.allowance.spender, quote.sellAmount), value: "0x0" }] })) as string;
        const rc = await waitReceipt(p, h);
        if (!rc || rc.status !== "0x1") throw new Error("Approval failed or timed out.");
        await fetchQuote();
      }
      setStep("simulating");
      const t = quote.transaction;
      try {
        await p.request({ method: "eth_call", params: [{ from: wallet.address, to: t.to, data: t.data, value: hex(t.value) }, "latest"] });
        setSimNote("Simulation succeeded.");
      } catch (e) {
        throw new Error(`Simulation reverted — not sending: ${(e as Error).message}`);
      }
      setStep("ready");
    } catch (e) {
      setStep("failed"); setErr(/reject|denied/i.test((e as Error).message) ? "Rejected in wallet. Nothing was sent." : (e as Error).message);
    }
  };

  const confirm = async () => {
    const p = evm();
    if (!p || !quote?.transaction) return;
    setStep("signing");
    try {
      const t = quote.transaction;
      const h = (await p.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: t.to, data: t.data, value: hex(t.value), ...(t.gas ? { gas: hex(t.gas) } : {}) }] })) as string;
      setHash(h);
      if (quote.intentToken) fetch("/api/treasury/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intentToken: quote.intentToken, txHash: h }) }).catch(() => {});
      setStep("pending");
      const rc = await waitReceipt(p, h);
      if (rc?.status === "0x1") { setStep("done"); setAmount(""); setQuote(null); }
      else { setStep("failed"); setErr(rc ? "Transaction reverted." : "Still pending — check the explorer."); }
    } catch (e) {
      setStep("failed"); setErr(/reject|denied/i.test((e as Error).message) ? "Rejected in wallet. Nothing was sent." : (e as Error).message);
    }
  };

  const sel = (v: Tok | null, set: (t: Tok) => void, label: string) => (
    <select aria-label={label} value={v?.token ?? ""} onChange={(e) => set(tokens.find((t) => t.token === e.target.value)!)} className="h-10 rounded-xl bg-surface-3 border border-line px-2 text-sm font-semibold">
      {tokens.map((t) => <option key={t.token} value={t.token}>{t.symbol}</option>)}
    </select>
  );

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3"><span className="font-semibold">Swap</span><Badge tone="info">{getChain(chainId)?.name} · 0x</Badge></div>
      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="text-xs text-muted mb-1.5">You pay</div>
        <div className="flex items-center gap-2"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))} placeholder="0.00" aria-label="EVM amount to pay" className="flex-1 min-w-0 bg-transparent text-2xl font-semibold outline-none num" />{sel(sell, setSell, "Sell token")}</div>
      </div>
      <div className="flex justify-center -my-2.5 relative z-10"><button onClick={() => { setSell(buy); setBuy(sell); setQuote(null); }} aria-label="Flip" className="h-9 w-9 rounded-xl border border-line bg-surface grid place-items-center"><ArrowDownUp size={15} /></button></div>
      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="text-xs text-muted mb-1.5">You receive (estimated)</div>
        <div className="flex items-center gap-2"><div className="flex-1 text-2xl font-semibold num truncate">{loading && !quote ? "…" : out !== null ? formatNumber(out, 6) : <span className="text-faint">0.00</span>}</div>{sel(buy, setBuy, "Buy token")}</div>
      </div>
      {err && <div className="mt-2 text-xs text-down flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{err}</div>}
      {quote && (
        <div className="mt-3 space-y-1.5 text-xs">
          <div className="flex justify-between"><span className="text-muted">Minimum received (1%)</span><span className="num">{formatNumber(minOut, 6)} {buy?.symbol}</span></div>
          <div className="flex justify-between"><span className="text-muted">Bajar platform fee</span><span className="num">{feeText}{fee?.applied && fee.isTest && <Badge tone="warn" className="ml-1">TEST</Badge>}</span></div>
          <div className="text-[11px] text-faint">{fee?.applied ? fee.note : fee?.reason}</div>
          {zx !== null && <div className="flex justify-between"><span className="text-muted">0x protocol fee</span><span className="num">{formatNumber(zx, 6)}</span></div>}
          {quote.totalNetworkFee && <div className="flex justify-between"><span className="text-muted">Network fee (est.)</span><span className="num">{formatNumber(Number(quote.totalNetworkFee) / 1e18, 6)} {getChain(chainId)?.nativeSymbol}</span></div>}
          <div className="flex justify-between"><span className="text-muted">Route</span><span>{quote.sources.join(" + ") || "—"}</span></div>
        </div>
      )}
      <Button size="lg" className="w-full mt-4" disabled={!quote?.transaction || insufficient} onClick={() => { setReview(true); setStep("idle"); setErr(null); setHash(null); setSimNote(null); }}>
        {insufficient ? `Insufficient ${sell?.symbol}` : quote?.issues.allowance ? "Review (approval needed)" : "Review swap"}
      </Button>
      <p className="mt-3 text-[11px] text-faint flex gap-1.5"><ShieldCheck size={13} className="shrink-0 text-brand" /> Every approval and swap is signed in your wallet. Approvals are for the exact amount only.</p>
      <Modal open={review} onClose={() => step !== "signing" && step !== "approving" && setReview(false)} title="Review swap">
        <div className="px-5 pb-5 space-y-3 text-sm">
          <div className="rounded-xl border border-line bg-surface-2 p-3 space-y-1.5">
            <div className="flex justify-between"><span className="text-muted">Pay</span><span className="num">{amount} {sell?.symbol}</span></div>
            <div className="flex justify-between"><span className="text-muted">Receive (est.)</span><span className="num">{formatNumber(out, 6)} {buy?.symbol}</span></div>
            <div className="flex justify-between"><span className="text-muted">Bajar fee</span><span className="num">{feeText}</span></div>
            {zx !== null && <div className="flex justify-between"><span className="text-muted">0x fee</span><span className="num">{formatNumber(zx, 6)}</span></div>}
          </div>
          {simNote && <div className="text-xs text-up flex gap-1.5"><CheckCircle2 size={13} />{simNote}</div>}
          {err && <Notice tone="down">{err}</Notice>}
          {hash && <a className="text-xs text-brand inline-flex items-center gap-1" href={`${getChain(chainId)!.explorer.tx}${hash}`} target="_blank" rel="noopener noreferrer">View transaction <ExternalLink size={11} /></a>}
          {step === "idle" && <Button size="lg" className="w-full" onClick={execute}>{quote?.issues.allowance ? "Approve & simulate" : "Simulate"}</Button>}
          {(step === "approving" || step === "simulating" || step === "signing" || step === "pending") && <Button size="lg" className="w-full" disabled><Loader2 size={16} className="animate-spin" /> {step === "approving" ? "Waiting for approval…" : step === "simulating" ? "Simulating…" : step === "signing" ? "Confirm in wallet…" : "Waiting for confirmation…"}</Button>}
          {step === "ready" && <Button size="lg" className="w-full" onClick={confirm}>Confirm in wallet</Button>}
          {step === "done" && <Button size="lg" className="w-full" onClick={() => setReview(false)}><CheckCircle2 size={16} /> Swap confirmed</Button>}
          {step === "failed" && <Button size="lg" variant="subtle" className="w-full" onClick={() => setReview(false)}>Close</Button>}
        </div>
      </Modal>
    </Card>
  );
}

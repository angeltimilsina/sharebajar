"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowDownUp, Loader2, AlertTriangle, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import { Badge, Button, Card, Notice } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import { chainFromEvmId, getChain } from "@/lib/chains";
import { KNOWN_TOKENS, NATIVE_EVM, ZEROX_CHAINS } from "@/lib/treasury/tokens";
import { formatNumber } from "@/lib/format";
import { addActivity } from "@/lib/activity";
import type { Eip1193 } from "@/lib/wallet/evm";
import { assertSafeZeroxQuote } from "@/lib/wallet/txguard";

export interface EvmTok { token: string; symbol: string; decimals: number }
type FeeDisclosure = { applied: true; bps: number; symbol: string | null; decimals: number | null; estimatedAmount: string | null; note: string; isTest: boolean } | { applied: false; reason: string };
interface EvmQuote {
  liquidityAvailable: boolean; buyAmount: string; minBuyAmount: string; sellAmount: string; allowanceTarget: string | null; priceImpact: number | null;
  zeroExFee: { amount: string; token: string } | null; issues: { allowance: { actual: string; spender: string } | null; balance: { token: string; actual: string; expected: string } | null; simulationIncomplete: boolean } | null;
  totalNetworkFee: string | null; transaction: { to: string; data: string; gas: string | null; gasPrice: string; value: string } | null; sources: string[]; fee: FeeDisclosure; intentToken: string | null; chainId: number;
}

const SUPPORTED = Object.keys(ZEROX_CHAINS);
const SLIPPAGE_BPS = 100;
const toBase = (v: string, d: number) => { if (!/^\d*\.?\d*$/.test(v) || !v || v === ".") return null; const [i, f = ""] = v.split("."); const n = (i || "0") + f.padEnd(d, "0").slice(0, d); return n.replace(/^0+/, "") || null; };
const hex = (v: string | bigint) => `0x${BigInt(v).toString(16)}`;
const approveData = (spender: string, amount: string) => `0x095ea7b3${spender.toLowerCase().replace(/^0x/, "").padStart(64, "0")}${BigInt(amount).toString(16).padStart(64, "0")}`;
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

async function waitReceipt(p: Eip1193, hash: string, timeoutMs = 180_000): Promise<{ status: string } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = (await p.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null)) as { status: string } | null;
    if (r) return r;
    await new Promise((res) => setTimeout(res, 2500));
  }
  return null;
}

/**
 * EVM execution panel (0x). Same two modes as the Solana panel:
 *  - "swap":  any token → the asset (destination prefilled)
 *  - "trade": buy / sell the asset against USDC (market order)
 * Quotes are indicative without a wallet; a wallet is requested only to execute,
 * and the wallet is asked to switch to the asset's network if needed.
 */
export function EvmSwapPanel({ chain: chainProp, asset, variant = "swap", side = "buy", lockAsset = false, embedded = false, assetHref }: {
  chain?: string; asset?: EvmTok; variant?: "swap" | "trade"; side?: "buy" | "sell"; lockAsset?: boolean; embedded?: boolean; assetHref?: string;
}) {
  const { wallet, openModal, evm } = useWallet();
  const walletChain = wallet?.chainType === "evm" ? chainFromEvmId(wallet.chainId ?? 0)?.id : undefined;
  const [pickedChain, setPickedChain] = useState<string>(chainProp ?? (walletChain && SUPPORTED.includes(walletChain) ? walletChain : "ethereum"));
  useEffect(() => { if (chainProp) setPickedChain(chainProp); }, [chainProp]);
  useEffect(() => { if (!chainProp && walletChain && SUPPORTED.includes(walletChain)) setPickedChain(walletChain); }, [walletChain, chainProp]);
  const chainId = SUPPORTED.includes(pickedChain) ? pickedChain : null;
  const tokens: EvmTok[] = useMemo(() => {
    if (!chainId) return [];
    const list: EvmTok[] = [{ token: NATIVE_EVM, symbol: getChain(chainId)!.nativeSymbol, decimals: 18 }, ...KNOWN_TOKENS[chainId]];
    if (asset && !list.some((t) => same(t.token, asset.token))) list.push(asset);
    return list;
  }, [chainId, asset]);

  const [sell, setSell] = useState<EvmTok | null>(null);
  const [buy, setBuy] = useState<EvmTok | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<EvmQuote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState(false);
  const [step, setStep] = useState<"idle" | "switching" | "approving" | "simulating" | "ready" | "signing" | "pending" | "done" | "failed">("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [simNote, setSimNote] = useState<string | null>(null);
  const req = useRef(0);

  // Prefill: the asset is the destination (swap / buy) or the source (sell).
  useEffect(() => {
    if (!chainId) return;
    const usdc = tokens.find((t) => t.symbol === "USDC") ?? tokens[1];
    const native = tokens[0];
    if (asset) {
      const counter = variant === "trade" ? (same(usdc?.token, asset.token) ? native : usdc) : (same(native.token, asset.token) ? usdc : native);
      if (side === "sell") { setSell(asset); setBuy(counter); } else { setSell(counter); setBuy(asset); }
    } else { setSell(usdc); setBuy(native); }
    setQuote(null);
  }, [chainId, asset, side, variant, tokens]);

  const evmWalletOk = wallet?.chainType === "evm";
  const base = sell ? toBase(amount, sell.decimals) : null;
  const fetchQuote = useCallback(async (): Promise<EvmQuote | null> => {
    if (!chainId || !sell || !buy || !base) { setQuote(null); return null; }
    const id = ++req.current;
    setLoading(true);
    try {
      // With a connected EVM wallet the quote is firm (includes the transaction); without one it is indicative.
      const r = await fetch(`/api/swap/evm?chain=${chainId}&sellToken=${sell.token}&buyToken=${buy.token}&sellAmount=${base}${evmWalletOk ? `&taker=${wallet!.address}` : ""}&slippageBps=${SLIPPAGE_BPS}`);
      const b = await r.json();
      if (id !== req.current) return null;
      if (!r.ok) throw new Error(b.error);
      if (!b.data.liquidityAvailable) throw new Error("No liquidity for this pair.");
      setQuote(b.data); setErr(null);
      return b.data as EvmQuote;
    } catch (e) { if (id === req.current) { setQuote(null); setErr((e as Error).message); } return null; }
    finally { if (id === req.current) setLoading(false); }
  }, [chainId, sell, buy, base, evmWalletOk, wallet]);
  useEffect(() => { const t = setTimeout(fetchQuote, 450); return () => clearTimeout(t); }, [fetchQuote]);

  if (!chainId) return <Card className="p-4"><Notice tone="warn">This network isn&apos;t supported for EVM swaps yet.</Notice></Card>;

  const c = getChain(chainId)!;
  const out = quote && buy ? Number(quote.buyAmount) / 10 ** buy.decimals : null;
  const minOut = quote && buy ? Number(quote.minBuyAmount) / 10 ** buy.decimals : null;
  const rate = out && Number(amount) ? out / Number(amount) : null;
  const zx = quote?.zeroExFee && sell ? Number(quote.zeroExFee.amount) / 10 ** (same(quote.zeroExFee.token, buy?.token) ? buy!.decimals : sell.decimals) : null;
  const insufficient = !!quote?.issues?.balance;
  const fee = quote?.fee;
  const feeText = fee?.applied ? `${(fee.bps / 100).toFixed(2)}%${fee.estimatedAmount && fee.decimals !== null ? ` ≈ ${formatNumber(Number(fee.estimatedAmount) / 10 ** fee.decimals, 6)} ${fee.symbol}` : ""}` : "None";
  const impactPct = quote?.priceImpact !== null && quote?.priceImpact !== undefined ? quote.priceImpact * 100 : null;
  const verb = variant === "trade" ? (side === "sell" ? `Sell ${sell?.symbol}` : `Buy ${buy?.symbol}`) : "swap";

  const preparedFor = useRef<string | null>(null);
  const ensureNetwork = async (p: Eip1193) => {
    const current = Number(await p.request({ method: "eth_chainId" }));
    if (current === ZEROX_CHAINS[chainId]) return;
    setStep("switching");
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(BigInt(ZEROX_CHAINS[chainId])) }] });
  };

  const execute = async () => {
    const p = evm();
    if (!p || !quote || !sell) return;
    try {
      await ensureNetwork(p);
      let q: EvmQuote | null = quote;
      if (!q.transaction) { await fetchQuote(); setStep("idle"); return; }
      // Approvals may only go to the 0x allowance contract, and the swap must target it.
      assertSafeZeroxQuote(q);
      if (q.issues?.allowance) {
        setStep("approving");
        const h = (await p.request({ method: "eth_sendTransaction", params: [{ from: wallet!.address, to: sell.token, data: approveData(q.issues.allowance.spender, q.sellAmount), value: "0x0" }] })) as string;
        addActivity({ chain: chainId, hash: h, kind: "approve", summary: `Allowed ${amount} ${sell.symbol} (exact amount)`, wallet: wallet!.address, assetHref });
        const rc = await waitReceipt(p, h);
        if (!rc || rc.status !== "0x1") throw new Error("Approval failed or timed out.");
        // Use the fresh quote (now without the allowance issue) from here on.
        q = await fetchQuote();
        if (!q?.transaction) throw new Error("Could not refresh the quote after approval. Try again.");
        assertSafeZeroxQuote(q);
      }
      setStep("simulating");
      const t = q.transaction!;
      try {
        await p.request({ method: "eth_call", params: [{ from: wallet!.address, to: t.to, data: t.data, value: hex(t.value) }, "latest"] });
        setSimNote("Simulation succeeded.");
      } catch (e) {
        throw new Error(`Simulation reverted — not sending: ${(e as Error).message}`);
      }
      preparedFor.current = wallet!.address.toLowerCase();
      setStep("ready");
    } catch (e) {
      setStep("failed"); setErr(/reject|denied/i.test((e as Error).message) ? "Rejected in wallet. Nothing was sent." : (e as Error).message);
    }
  };

  const confirm = async () => {
    const p = evm();
    if (!p || !quote?.transaction) return;
    try {
      // Same account and network as the simulated quote, or start over.
      if (wallet?.address.toLowerCase() !== preparedFor.current) throw new Error("Your wallet account changed since this swap was prepared. Review it again.");
      await ensureNetwork(p);
      assertSafeZeroxQuote(quote);
      setStep("signing");
      const t = quote.transaction;
      const h = (await p.request({ method: "eth_sendTransaction", params: [{ from: wallet!.address, to: t.to, data: t.data, value: hex(t.value), ...(t.gas ? { gas: hex(t.gas) } : {}) }] })) as string;
      setHash(h);
      addActivity({ chain: chainId, hash: h, kind: variant === "trade" ? "trade" : "swap", summary: variant === "trade" ? `${side === "sell" ? "Sold" : "Bought"} ${side === "sell" ? sell?.symbol : buy?.symbol} · ${amount} ${sell?.symbol}` : `Swapped ${amount} ${sell?.symbol} → ${buy?.symbol}`, wallet: wallet!.address, assetHref });
      if (quote.intentToken) fetch("/api/treasury/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intentToken: quote.intentToken, txHash: h }) }).catch(() => {});
      setStep("pending");
      const rc = await waitReceipt(p, h);
      if (rc?.status === "0x1") { setStep("done"); setAmount(""); setQuote(null); }
      else { setStep("failed"); setErr(rc ? "Transaction reverted." : "Still pending — track it in Portfolio."); }
    } catch (e) {
      setStep("failed"); setErr(/reject|denied/i.test((e as Error).message) ? "Rejected in wallet. Nothing was sent." : (e as Error).message);
    }
  };

  const sel = (v: EvmTok | null, set: (t: EvmTok) => void, label: string, locked: boolean) => (
    <select aria-label={label} disabled={locked} value={v?.token ?? ""} onChange={(e) => { set(tokens.find((t) => t.token === e.target.value)!); setQuote(null); }} className="h-10 rounded-xl bg-surface-3 px-2.5 text-sm font-semibold disabled:opacity-100 disabled:appearance-none">
      {tokens.map((t) => <option key={t.token} value={t.token}>{t.symbol}</option>)}
    </select>
  );
  const lockedSell = lockAsset && variant === "trade" && side === "sell";
  const lockedBuy = lockAsset && (variant === "swap" || side !== "sell");

  const cta = (() => {
    if (!base) return <Button size="lg" className="w-full" disabled>Enter an amount</Button>;
    if (loading && !quote) return <Button size="lg" className="w-full" disabled><Loader2 size={16} className="animate-spin" /> Fetching best route…</Button>;
    if (!quote) return <Button size="lg" className="w-full" disabled>{err ? "No route" : "Get quote"}</Button>;
    if (!evmWalletOk) return <Button size="lg" className="w-full" onClick={openModal}>Connect an EVM wallet to {verb.replace(/^(Buy|Sell)/, (m) => m.toLowerCase())}</Button>;
    if (insufficient) return <Button size="lg" className="w-full" disabled>Insufficient {sell?.symbol}</Button>;
    return <Button size="lg" className="w-full" onClick={() => { setReview(true); setStep("idle"); setErr(null); setHash(null); setSimNote(null); }}>{quote.issues?.allowance ? "Review (approval needed)" : variant === "trade" ? `Review · ${verb}` : "Review swap"}</Button>;
  })();

  return (
    <Card className={clsx("p-4", embedded && "!border-0 !shadow-none !bg-transparent p-0")}>
      <div className="flex items-center justify-between mb-3 gap-2">
        <span className="text-xs text-muted">{variant === "trade" ? "Market order" : "Best route"}</span>
        {chainProp ? <Badge tone="info">{c.name} · 0x</Badge> : (
          <select aria-label="Network" value={pickedChain} onChange={(e) => setPickedChain(e.target.value)} className="h-8 rounded-full bg-surface-2 px-3 text-xs">
            {SUPPORTED.map((id) => <option key={id} value={id}>{getChain(id)?.name}</option>)}
          </select>
        )}
      </div>
      <div className="rounded-2xl bg-surface-2 p-3">
        <div className="text-xs text-muted mb-1.5">You pay</div>
        <div className="flex items-center gap-2"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))} placeholder="0.00" aria-label="EVM amount to pay" className="flex-1 min-w-0 bg-transparent text-2xl font-semibold outline-none num" />{sel(sell, setSell, "Sell token", lockedSell)}</div>
      </div>
      <div className="flex justify-center -my-2.5 relative z-10"><button disabled={lockAsset} onClick={() => { setSell(buy); setBuy(sell); setQuote(null); }} aria-label="Flip" className="h-9 w-9 rounded-xl border border-line bg-surface grid place-items-center disabled:opacity-40"><ArrowDownUp size={15} /></button></div>
      <div className="rounded-2xl bg-surface-2 p-3">
        <div className="text-xs text-muted mb-1.5">You receive (estimated)</div>
        <div className="flex items-center gap-2"><div className="flex-1 text-2xl font-semibold num truncate">{loading && !quote ? "…" : out !== null ? formatNumber(out, 6) : <span className="text-faint">0.00</span>}</div>{sel(buy, setBuy, "Buy token", lockedBuy)}</div>
      </div>
      {err && <div className="mt-2 text-xs text-down flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{err}</div>}
      {quote && (
        <div className="mt-3 space-y-1.5 text-xs">
          <Row k="Rate" v={rate ? `1 ${sell?.symbol} ≈ ${formatNumber(rate, 6)} ${buy?.symbol}` : "—"} />
          <Row k="Price impact" v={impactPct === null ? <span className="text-muted" title="Market price for one of the tokens is unavailable">Unavailable</span> : <span className={impactPct > 5 ? "text-down" : impactPct > 1 ? "text-warn" : "text-up"} title="Quote value vs. market price, after fees">{impactPct < 0.01 ? "< 0.01%" : `${impactPct.toFixed(2)}%`}</span>} />
          <Row k="Platform fee" v={<>{feeText}{fee?.applied && fee.isTest && <Badge tone="warn" className="ml-1">TEST</Badge>}</>} />
          <div className="text-[11px] text-faint">{fee?.applied ? fee.note : fee?.reason}</div>
          {zx !== null && <Row k="0x protocol fee" v={formatNumber(zx, 6)} />}
          <Row k={`Minimum received (${SLIPPAGE_BPS / 100}% slippage)`} v={`${formatNumber(minOut, 6)} ${buy?.symbol}`} />
          <Row k="Route" v={quote.sources.join(" + ") || "0x"} />
          <Row k="Network fee" v={quote.totalNetworkFee ? `≈ ${formatNumber(Number(quote.totalNetworkFee) / 1e18, 6)} ${c.nativeSymbol}` : evmWalletOk ? "Estimated at review" : "Shown after connecting a wallet"} />
          {!quote.transaction && <div className="text-[11px] text-faint">Indicative quote — a firm quote is fetched for your wallet before you sign.</div>}
        </div>
      )}
      <div className="mt-4">{cta}</div>
      <p className="mt-3 text-[11px] text-faint flex gap-1.5"><ShieldCheck size={13} className="shrink-0 text-accent" /> Every approval and swap is signed in your wallet. Approvals are for the exact amount only.</p>
      <Modal open={review} onClose={() => !["signing", "approving", "switching"].includes(step) && setReview(false)} title={variant === "trade" ? `Review · ${verb}` : "Review swap"}>
        <div className="px-5 pb-5 space-y-3 text-sm">
          <div className="rounded-2xl bg-surface-2 p-3 space-y-1.5">
            <Row k="Pay" v={`${amount} ${sell?.symbol}`} />
            <Row k="Receive (est.)" v={`${formatNumber(out, 6)} ${buy?.symbol}`} />
            <Row k="Minimum received" v={`${formatNumber(minOut, 6)} ${buy?.symbol}`} />
            <Row k="Rate" v={rate ? `1 ${sell?.symbol} ≈ ${formatNumber(rate, 6)} ${buy?.symbol}` : "—"} />
            <Row k="Price impact" v={impactPct === null ? "Unavailable" : `${impactPct.toFixed(2)}%`} />
            <Row k="Platform fee" v={feeText} />
            {zx !== null && <Row k="0x fee" v={formatNumber(zx, 6)} />}
            <Row k="Network fee" v={quote?.totalNetworkFee ? `≈ ${formatNumber(Number(quote.totalNetworkFee) / 1e18, 6)} ${c.nativeSymbol}` : "Estimated by your wallet"} />
            <Row k="Route" v={quote?.sources.join(" + ") || "0x"} />
          </div>
          {simNote && <div className="text-xs text-up flex gap-1.5"><CheckCircle2 size={13} />{simNote}</div>}
          {err && <Notice tone="down">{err}</Notice>}
          {hash && <div className="flex flex-wrap gap-3 text-xs"><a className="underline underline-offset-2 inline-flex items-center gap-1" href={`${c.explorer.tx}${hash}`} target="_blank" rel="noopener noreferrer">View transaction <ExternalLink size={11} /></a><Link href="/portfolio" className="underline underline-offset-2">Track in Portfolio →</Link></div>}
          {step === "idle" && <Button size="lg" className="w-full" onClick={execute}>{quote?.issues?.allowance ? "Approve & simulate" : "Simulate"}</Button>}
          {(["switching", "approving", "simulating", "signing", "pending"] as const).includes(step as never) && <Button size="lg" className="w-full" disabled><Loader2 size={16} className="animate-spin" /> {step === "switching" ? `Switch to ${c.name} in your wallet…` : step === "approving" ? "Waiting for approval…" : step === "simulating" ? "Simulating…" : step === "signing" ? "Confirm in wallet…" : "Waiting for confirmation…"}</Button>}
          {step === "ready" && <Button size="lg" className="w-full" onClick={confirm}>Confirm in wallet</Button>}
          {step === "done" && <Button size="lg" className="w-full" onClick={() => setReview(false)}><CheckCircle2 size={16} /> Confirmed</Button>}
          {step === "failed" && <Button size="lg" variant="subtle" className="w-full" onClick={() => setReview(false)}>Close</Button>}
        </div>
      </Modal>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-muted shrink-0">{k}</span><span className="num text-right">{v}</span></div>;
}

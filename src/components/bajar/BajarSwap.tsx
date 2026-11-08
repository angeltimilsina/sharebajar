"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, ExternalLink, Loader2, Info } from "lucide-react";
import { Button, Card, Notice, Badge } from "../ui/primitives";
import { SWAP_ASSETS, quoteSwap, executeSwap, crossChainStatus, providerFor, type SwapQuote, type SwapAsset } from "@/lib/bajar/swap";
import { explorerTx } from "@/lib/bajar/send";
import { toBase } from "@/lib/bajar/util";
import { formatNumber } from "@/lib/format";
import { usePortfolio } from "./PortfolioPanel";

const sel = "rounded-lg border border-line bg-surface-2 px-2 py-2 text-sm";
const fmt = (raw: string | null, d: number) => (raw === null ? "—" : formatNumber(Number(raw) / 10 ** d, 6));

export function BajarSwap() {
  const p = usePortfolio(30_000);
  const [fromKey, setFromKey] = useState("usdc-sol");
  const [toKey, setToKey] = useState("usdt-sol");
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState(50);
  const [q, setQ] = useState<SwapQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<{ hash: string; from: SwapAsset; to: SwapAsset; status?: string } | null>(null);
  const reqId = useRef(0);
  const from = SWAP_ASSETS.find((a) => a.key === fromKey)!, to = SWAP_ASSETS.find((a) => a.key === toKey)!;
  const bal = p.data?.holdings.find((h) => h.network === from.network && (h.token.toLowerCase() === from.token.toLowerCase() || (from.native && h.native)));
  const provider = providerFor(from, to);

  useEffect(() => {
    setQ(null); setErr(null);
    const raw = toBase(amount, from.decimals);
    if (!raw || raw <= BigInt(0) || fromKey === toKey) return;
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(() => quoteSwap(from, to, raw, slip).then((r) => { if (id === reqId.current) setQ(r); }).catch((e) => { if (id === reqId.current) setErr((e as Error).message); }).finally(() => { if (id === reqId.current) setLoading(false); }), 500);
    return () => clearTimeout(t);
  }, [amount, fromKey, toKey, slip]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track cross-chain delivery
  useEffect(() => {
    if (!tx || tx.from.network === tx.to.network || tx.status === "DONE" || tx.status === "FAILED") return;
    const t = setInterval(() => crossChainStatus(tx.hash, tx.from.network, tx.to.network).then((s) => setTx((cur) => cur && { ...cur, status: s.status + (s.substatusMessage ? ` — ${s.substatusMessage}` : "") })).catch(() => {}), 10_000);
    return () => clearInterval(t);
  }, [tx]);

  const run = async () => {
    if (!q) return;
    setBusy(true); setErr(null);
    try {
      let quote = q;
      if (Date.now() - q.fetchedAt > 45_000) { quote = await quoteSwap(from, to, BigInt(q.amountIn), slip); setQ(quote); }
      const hash = await executeSwap(quote);
      setTx({ hash, from, to, status: from.network === to.network ? "Submitted" : "PENDING" });
      setAmount(""); p.refresh();
    } catch (e) {
      const m = (e as Error).message;
      setErr(/rejected/i.test(m) ? "You rejected the request. Nothing was sent." : m);
    } finally { setBusy(false); }
  };

  return (
    <Card className="p-5 space-y-3 max-w-xl">
      <div className="flex gap-2 items-end">
        <label className="flex-1 text-xs text-muted">From
          <select className={`${sel} w-full mt-1`} value={fromKey} onChange={(e) => setFromKey(e.target.value)}>{SWAP_ASSETS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
        </label>
        <Button variant="ghost" aria-label="Flip" onClick={() => { setFromKey(toKey); setToKey(fromKey); }}><ArrowDownUp size={16} /></Button>
        <label className="flex-1 text-xs text-muted">To
          <select className={`${sel} w-full mt-1`} value={toKey} onChange={(e) => setToKey(e.target.value)}>{SWAP_ASSETS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
        </label>
      </div>
      <div>
        <input className="w-full rounded-lg border border-line bg-surface-2 px-3 py-3 text-lg tabular-nums outline-none focus:border-brand" placeholder={`0.0 ${from.symbol}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" data-testid="bajar-swap-amount" />
        <div className="mt-1 text-[11px] text-muted">Balance: {bal ? `${formatNumber(bal.amount, 6)} ${from.symbol}` : "0"}</div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">Slippage
        {[30, 50, 100, 300].map((s) => <Button key={s} size="sm" variant={slip === s ? "primary" : "outline"} onClick={() => setSlip(s)}>{s / 100}%</Button>)}
      </div>
      {(from.wrappedBtc || to.wrappedBtc) && <Notice tone="warn">{(from.wrappedBtc ? from : to).symbol} is wrapped BTC — a token on {(from.wrappedBtc ? from : to).network} backed by a custodian/bridge. It is not native bitcoin.</Notice>}
      {provider === "lifi" && <p className="text-[11px] text-muted inline-flex gap-1"><Info size={12} className="shrink-0 mt-0.5" />{from.network === "bitcoin" || to.network === "bitcoin" ? "Native BTC routes use a bridge/swap protocol via LI.FI. Delivery can take minutes to hours." : "Cross-chain route via LI.FI bridge aggregation."}</p>}
      {loading && <p className="text-xs text-muted inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" />Fetching live quote…</p>}
      {q && (
        <dl className="rounded-xl border border-line divide-y divide-line text-xs" data-testid="bajar-swap-quote">
          <Row k="You receive (est.)" v={`${fmt(q.amountOut, to.decimals)} ${to.symbol}`} />
          <Row k="Minimum received" v={`${fmt(q.minOut, to.decimals)} ${to.symbol}`} />
          <Row k="Route" v={<span>{q.providerLabel} <span className="text-faint">· {q.route}</span></span>} />
          <Row k="Bajar fee" v={q.fee.applied ? <Badge tone="brand">{((q.fee.bps ?? 0) / 100).toFixed(2)}%{q.fee.estimatedAmount && q.fee.decimals != null ? ` ≈ ${fmt(q.fee.estimatedAmount, q.fee.decimals)} ${q.fee.symbol}` : ""}</Badge> : <span title={q.fee.reason}>None{q.fee.reason ? ` — ${q.fee.reason}` : ""}</span>} />
          {q.fee.applied && q.fee.note && <div className="px-3 py-2 text-[11px] text-faint">{q.fee.note}</div>}
          {q.durationSec !== null && <Row k="Est. time" v={q.durationSec < 90 ? `~${q.durationSec}s` : `~${Math.round(q.durationSec / 60)} min`} />}
        </dl>
      )}
      {err && <Notice tone="down">{err}</Notice>}
      {tx && <Notice tone="info" title={tx.status ?? "Submitted"}>Source transaction: <a className="text-brand inline-flex items-center gap-1" href={explorerTx(tx.from.network, tx.hash)} target="_blank" rel="noopener noreferrer">{tx.hash.slice(0, 12)}… <ExternalLink size={11} /></a></Notice>}
      <Button className="w-full" size="lg" disabled={!q || busy || loading} onClick={run} data-testid="bajar-swap-go">{busy ? <Loader2 size={16} className="animate-spin" /> : "Review swap"}</Button>
      <p className="text-[11px] text-faint">Each step (token approval, swap, bridge) opens a Bajar approval prompt. Nothing is signed without your click.</p>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>;
}

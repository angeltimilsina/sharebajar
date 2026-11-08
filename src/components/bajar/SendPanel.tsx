"use client";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button, Card, Notice } from "../ui/primitives";
import { usePortfolio, type Holding } from "./PortfolioPanel";
import { sendBtc, sendEvm, sendSolana, btcFees, previewBtcSend, explorerTx, type BtcFees } from "@/lib/bajar/send";
import { toBase } from "@/lib/bajar/util";
import { formatNumber } from "@/lib/format";

const input = "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand";

export function SendPanel() {
  const p = usePortfolio(30_000);
  const assets = useMemo(() => (p.data?.holdings ?? []).filter((h) => h.amount > 0), [p.data]);
  const [key, setKey] = useState("");
  const h: Holding | undefined = assets.find((a) => a.network + a.token === key) ?? assets[0];
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [fees, setFees] = useState<BtcFees | null>(null);
  const [feeRate, setFeeRate] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ network: string; hash: string } | null>(null);
  const isBtc = h?.network === "bitcoin";

  useEffect(() => { if (isBtc) btcFees().then((f) => { setFees(f); setFeeRate((r) => r ?? f.halfHourFee); }).catch(() => {}); }, [isBtc]);

  useEffect(() => {
    setPreview(null);
    if (!isBtc || !to || !amount || !feeRate) return;
    const sats = amount === "max" ? "max" : Number(toBase(amount, 8) ?? 0);
    if (sats !== "max" && !sats) return;
    const t = setTimeout(() => previewBtcSend(to, sats, feeRate).then((pl) => setPreview(`Network fee ${(pl.fee / 1e8).toFixed(8)} BTC · ${pl.vsize} vB · ${pl.inputs.length} input(s)`)).catch((e) => setPreview((e as Error).message)), 400);
    return () => clearTimeout(t);
  }, [isBtc, to, amount, feeRate]);

  if (!p.data) return <Card className="p-5 text-sm text-muted"><Loader2 className="animate-spin inline mr-2" size={14} />Loading balances…</Card>;
  if (!assets.length || !h) return <Card className="p-5 text-sm text-muted">No funded assets to send yet.</Card>;

  const submit = async () => {
    setErr(null); setDone(null); setBusy(true);
    try {
      let hash: string;
      if (isBtc) {
        const sats = amount === "max" ? "max" as const : Number(toBase(amount, 8));
        hash = await sendBtc(to.trim(), sats, feeRate!);
      } else {
        const raw = toBase(amount, h.decimals);
        if (raw === null || raw <= BigInt(0)) throw new Error("Enter a valid amount.");
        if (raw > BigInt(h.amountRaw)) throw new Error("Amount exceeds balance.");
        const label = `${amount} ${h.symbol}`;
        if (h.network === "solana") hash = await sendSolana(h.native ? "native" : h.token, to.trim(), raw, h.decimals, label);
        else hash = await sendEvm(h.network, h.native ? "native" : h.token, to.trim(), raw, label);
      }
      setDone({ network: h.network, hash }); setAmount(""); p.refresh();
    } catch (e) {
      const m = (e as Error).message;
      setErr(/rejected/i.test(m) ? "You rejected the request. Nothing was sent." : m);
    } finally { setBusy(false); }
  };

  return (
    <Card className="p-5 space-y-3 max-w-xl">
      <label className="block text-xs text-muted">Asset
        <select className={`${input} mt-1`} value={h.network + h.token} onChange={(e) => { setKey(e.target.value); setAmount(""); }}>
          {assets.map((a) => <option key={a.network + a.token} value={a.network + a.token}>{a.symbol} · {a.networkName}{a.wrappedBtc ? " (wrapped BTC)" : ""} — {formatNumber(a.amount, 6)}</option>)}
        </select>
      </label>
      <label className="block text-xs text-muted">Recipient ({h.networkName} address)
        <input className={`${input} mt-1 font-mono`} value={to} onChange={(e) => setTo(e.target.value)} placeholder={isBtc ? "bc1…" : h.network === "solana" ? "Solana address" : "0x…"} spellCheck={false} />
      </label>
      <label className="block text-xs text-muted">Amount
        <div className="mt-1 flex gap-2">
          <input className={input} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.max]/g, ""))} placeholder="0.0" inputMode="decimal" />
          {isBtc && <Button variant="outline" onClick={() => setAmount("max")}>Max</Button>}
        </div>
      </label>
      {isBtc && fees && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {([["Fast", fees.fastestFee], ["30 min", fees.halfHourFee], ["1 hour", fees.hourFee], ["Economy", fees.economyFee]] as const).map(([l, r]) => (
            <Button key={l} size="sm" variant={feeRate === r ? "primary" : "outline"} onClick={() => setFeeRate(r)}>{l} · {r} sat/vB</Button>
          ))}
        </div>
      )}
      {preview && <p className="text-xs text-muted">{preview}</p>}
      {!isBtc && <p className="text-[11px] text-faint">Network fee is estimated and the transaction simulated before you approve.</p>}
      {err && <Notice tone="down">{err}</Notice>}
      {done && <Notice tone="info" title="Submitted">Broadcast to {done.network}. <a className="text-brand inline-flex items-center gap-1" href={explorerTx(done.network, done.hash)} target="_blank" rel="noopener noreferrer">View <ExternalLink size={11} /></a> <span className="font-mono text-[11px] break-all block">{done.hash}</span></Notice>}
      <Button className="w-full" disabled={busy || !to || !amount || (isBtc && !feeRate)} onClick={submit}>{busy ? <Loader2 size={14} className="animate-spin" /> : "Review & send"}</Button>
    </Card>
  );
}

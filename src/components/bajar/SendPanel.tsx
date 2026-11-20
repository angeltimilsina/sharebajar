"use client";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button, Card, Notice } from "../ui/primitives";
import { usePortfolio, type Holding } from "./PortfolioPanel";
import { sendBtc, sendEvm, sendSolana, btcFees, previewBtcSend, explorerTx, checkAddress, knownRecipients, type BtcFees, type ServerRisk } from "@/lib/bajar/send";
import { localRecipientChecks, type RecipientFlag } from "@/lib/bajar/security";
import { bajar } from "@/lib/bajar/session";
import { ShieldAlert, ShieldCheck, Info } from "lucide-react";
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
  const [risk, setRisk] = useState<{ flags: RecipientFlag[]; server: ServerRisk | null; checking: boolean; for: string } | null>(null);
  const [ack, setAck] = useState(false);

  // Recipient screening: local (poisoning, self, contract, large share) + server (malicious lists, on-chain type).
  useEffect(() => {
    setAck(false);
    const addr = to.trim();
    if (!h || addr.length < 26) { setRisk(null); return; }
    const a = bajar.accounts()!;
    const raw = toBase(amount === "max" ? "0" : amount || "0", h.decimals);
    const share = amount === "max" ? 1 : raw && BigInt(h.amountRaw) > BigInt(0) ? Number((raw * BigInt(10_000)) / BigInt(h.amountRaw)) / 10_000 : 0;
    const local = localRecipientChecks(addr, {
      own: [a.bitcoin.address, a.evm.address, a.solana.address], history: knownRecipients(h.network),
      tokenAddresses: (p.data?.holdings ?? []).filter((x) => !x.native).map((x) => x.token), amountShareOfBalance: share,
    });
    setRisk({ flags: local, server: null, checking: true, for: addr });
    const t = setTimeout(() => checkAddress(h.network, addr).then((server) => setRisk((r) => (r && r.for === addr ? { ...r, server, checking: false } : r))), 450);
    return () => clearTimeout(t);
  }, [to, amount, h?.network, h?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const allFlags: RecipientFlag[] = [...(risk?.flags ?? []), ...(risk?.server?.flags ?? [])];
  const danger = allFlags.some((f) => f.severity === "danger");
  const invalid = risk?.server?.valid === false;

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
      {risk && (
        <div className="rounded-xl border border-line p-3 space-y-1.5 text-xs" data-testid="bajar-recipient-check" aria-live="polite">
          <div className="flex items-center gap-1.5 font-semibold">
            {risk.checking ? <Loader2 size={13} className="animate-spin" /> : danger ? <ShieldAlert size={14} className="text-down" /> : allFlags.some((f) => f.severity === "warn") ? <ShieldAlert size={14} className="text-warn" /> : <ShieldCheck size={14} className="text-up" />}
            Recipient check {risk.checking ? "…" : danger ? "— high risk" : allFlags.length ? "" : "— no issues found"}
          </div>
          {allFlags.map((f) => (
            <p key={f.code + f.message} className={`flex gap-1.5 ${f.severity === "danger" ? "text-down" : f.severity === "warn" ? "text-warn" : "text-muted"}`}>
              {f.severity === "info" ? <Info size={12} className="shrink-0 mt-0.5" /> : <ShieldAlert size={12} className="shrink-0 mt-0.5" />}{f.message}
            </p>
          ))}
          {!risk.checking && risk.server && <p className="text-faint">Sources: {risk.server.sources.join(", ") || "format checks"}</p>}
          {!risk.checking && !risk.server && <p className="text-faint">Online screening unavailable — local checks only.</p>}
          {danger && !invalid && (
            <label className="flex items-start gap-2 pt-1 text-down"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="bajar-risk-ack" />I understand the risk and still want to send to this address.</label>
          )}
        </div>
      )}
      {preview && <p className="text-xs text-muted">{preview}</p>}
      {!isBtc && <p className="text-[11px] text-faint">Network fee is estimated and the transaction simulated before you approve.</p>}
      {err && <Notice tone="down">{err}</Notice>}
      {done && <Notice tone="info" title="Submitted">Broadcast to {done.network}. <a className="text-brand inline-flex items-center gap-1" href={explorerTx(done.network, done.hash)} target="_blank" rel="noopener noreferrer">View <ExternalLink size={11} /></a> <span className="font-mono text-[11px] break-all block">{done.hash}</span></Notice>}
      <Button className="w-full" disabled={busy || !to || !amount || (isBtc && !feeRate) || invalid || (danger && !ack) || !!risk?.checking} onClick={submit}>{busy ? <Loader2 size={14} className="animate-spin" /> : "Review & send"}</Button>
    </Card>
  );
}

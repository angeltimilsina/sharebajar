"use client";
import { useEffect, useState } from "react";
import { Download, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { treasuryChain as getChain } from "@/lib/treasury/chainInfo";
import { shortAddress } from "@/lib/format";
import { useWallet } from "../wallet/WalletProvider";
import { getSolanaProvider, solanaSignAndSend } from "@/lib/wallet/solana";
import { getEvmProvider } from "@/lib/wallet/evm";
import { SOLANA_RPC } from "@/lib/wallet/rpc";
import { Badge, Button, Card, CardHeader, Notice, Tabs } from "../ui/primitives";
import { ChainIcon } from "../ui/ChainIcon";
import { api, can, fmtUsd, type Me } from "./client";
import { useTreasuries } from "./Treasuries";

/* eslint-disable @typescript-eslint/no-explicit-any */
const download = (name: string, data: unknown) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = name;
  a.click();
};

export function Operations({ me }: { me: Me }) {
  const { list } = useTreasuries();
  const [bals, setBals] = useState<Record<string, any>>({});
  const [expenses, setExpenses] = useState<any[]>([]);
  useEffect(() => {
    (list ?? []).forEach((t) => api<any>(`/api/treasury/treasuries/${t.id}/balances`).then((b) => setBals((m) => ({ ...m, [t.id]: b }))).catch((e) => setBals((m) => ({ ...m, [t.id]: { error: e.message } }))));
    api<any>("/api/treasury/revenue").then((r) => setExpenses(r.expenses ?? [])).catch(() => {});
  }, [list]);
  const total = Object.values(bals).reduce((s: number, b: any) => s + (b?.totalUsd ?? 0), 0);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Treasury assets" sub={`Estimated total ${fmtUsd(total)} across ${(list ?? []).length} accounts · live on-chain balances`} />
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="text-faint border-y border-line"><tr>{["Treasury", "Token", "Amount", "Price", "USD"].map((h) => <th key={h} className="text-left font-normal px-4 py-2">{h}</th>)}</tr></thead>
            <tbody>
              {(list ?? []).flatMap((t) => {
                const b = bals[t.id];
                if (!b) return [<tr key={t.id}><td className="px-4 py-2" colSpan={5}>{t.label} — loading…</td></tr>];
                if (b.error) return [<tr key={t.id}><td className="px-4 py-2 text-down" colSpan={5}>{t.label} — {b.error}</td></tr>];
                return b.balances.map((x: any, i: number) => (
                  <tr key={t.id + x.token + i} className="border-b border-line/60">
                    <td className="px-4 py-1.5">{i === 0 && <span className="inline-flex items-center gap-1.5"><ChainIcon chain={t.chain} size={13} />{t.label}</span>}</td>
                    <td className="px-4">{x.symbol}</td><td className="px-4 num">{x.amount}</td><td className="px-4 num" title={x.priceSource}>{x.usdPrice === null ? "—" : fmtUsd(x.usdPrice)}</td><td className="px-4 num">{fmtUsd(x.usdValue)}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {can(me, "admin") ? <OpBuilder list={list ?? []} bals={bals} /> : <Notice>Treasury operations require the admin role. Monitoring is read-only.</Notice>}
      <Card>
        <CardHeader title="Operating expenses" sub="Network fees paid by treasury wallets (indexed from on-chain transactions)" />
        {!expenses.length ? <p className="px-4 pb-4 text-xs text-muted">None recorded.</p> : (
          <table className="w-full text-xs num mb-3"><thead className="text-faint"><tr><th className="text-left font-normal px-4">Time</th><th className="text-left font-normal">Network</th><th className="text-left font-normal">Tx</th><th className="text-right font-normal">Fee</th><th className="text-right font-normal px-4">USD</th></tr></thead>
            <tbody>{expenses.slice(0, 30).map((e) => <tr key={e.id} className="border-t border-line/60"><td className="px-4 py-1">{e.block_time ? new Date(e.block_time).toLocaleString() : "—"}</td><td>{getChain(e.chain)?.name}</td><td><a className="hover:text-brand" href={`${getChain(e.chain)?.explorer.tx}${e.tx_hash}`} target="_blank" rel="noopener noreferrer">{shortAddress(e.tx_hash, 6, 4)}</a></td><td className="text-right">{Number(e.native_fee).toFixed(6)} {e.native_symbol}</td><td className="text-right px-4">{fmtUsd(e.usd_value === null ? null : Number(e.usd_value))}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  );
}

function OpBuilder({ list, bals }: { list: any[]; bals: Record<string, any> }) {
  const [op, setOp] = useState<"transfer" | "convert">("transfer");
  const [src, setSrc] = useState("");
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState("");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const { wallet } = useWallet();
  const s = list.find((t) => t.id === src);
  const tokens = s ? (bals[s.id]?.balances ?? []) : [];
  const dests = list.filter((t) => s && t.id !== s.id && t.chain === s.chain && t.ownership && t.integrityOk);
  const build = async () => {
    setBusy(true); setErr(null); setRes(null); setSent(null);
    try { setRes(await api("/api/treasury/ops", { body: op === "transfer" ? { op, treasuryId: src, toTreasuryId: dest, token, amount } : { op, treasuryId: src, token, amount } })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const signerMatches = res && wallet && (res.signer ?? "").toLowerCase() === wallet.address.toLowerCase();
  const execute = async () => {
    setBusy(true); setErr(null);
    try {
      if (res.kind === "solana-tx") {
        const p = getSolanaProvider(wallet!.walletId);
        if (!p) throw new Error("Wallet unavailable");
        setSent(await solanaSignAndSend(p, res.transaction, SOLANA_RPC));
      } else {
        const p = getEvmProvider(wallet!.walletId)!;
        let last = "";
        for (const t of res.transactions) {
          if (!confirm(`Sign in wallet: ${t.label}?`)) throw new Error("Cancelled.");
          last = (await p.request({ method: "eth_sendTransaction", params: [{ from: wallet!.address, to: t.to, data: t.data, value: `0x${BigInt(t.value).toString(16)}` }] })) as string;
        }
        setSent(last);
      }
    } catch (e) { setErr(/reject|denied/i.test((e as Error).message) ? "Rejected in wallet." : (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between"><div className="text-sm font-semibold">Treasury operations</div><Tabs size="sm" tabs={[{ id: "transfer", label: "Transfer / consolidate" }, { id: "convert", label: "Convert to USDC" }]} value={op} onChange={(v) => { setOp(v); setRes(null); }} /></div>
      <p className="text-xs text-muted">Bajar only <b>prepares and simulates</b> transactions. Execution always requires the treasury wallet or multisig signers. Transfers can only go to other registered, ownership-verified treasuries (address allowlist). No automatic withdrawals exist.</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <select value={src} onChange={(e) => { setSrc(e.target.value); setToken(""); setDest(""); setRes(null); }} className="h-10 rounded-lg bg-surface-2 border border-line px-2 text-sm"><option value="">Source treasury…</option>{list.filter((t) => t.kind !== "jupiter_referral").map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        <select value={token} onChange={(e) => setToken(e.target.value)} className="h-10 rounded-lg bg-surface-2 border border-line px-2 text-sm"><option value="">Token…</option>{tokens.map((b: any) => <option key={b.token} value={b.token}>{b.symbol} ({b.amount})</option>)}</select>
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Amount" className="h-10 rounded-lg bg-surface-2 border border-line px-3 text-sm num" />
        {op === "transfer" && <select value={dest} onChange={(e) => setDest(e.target.value)} className="h-10 rounded-lg bg-surface-2 border border-line px-2 text-sm"><option value="">Destination…</option>{dests.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>}
      </div>
      <Button size="sm" disabled={busy || !src || !token || !amount || (op === "transfer" && !dest)} onClick={build}>{busy && !res ? <Loader2 size={13} className="animate-spin" /> : null} Prepare & simulate</Button>
      {err && <Notice tone="down">{err}</Notice>}
      {res && (
        <div className="rounded-xl border border-line p-3 space-y-2 text-xs">
          <div className="font-medium text-sm">{res.summary}</div>
          <div className="flex gap-1.5 items-center">{(res.simulation?.ok ?? !res.simulation?.err) ? <CheckCircle2 size={14} className="text-up" /> : <AlertTriangle size={14} className="text-down" />}<span>{res.simulation?.detail ?? (res.simulation?.err ? `Simulation failed: ${JSON.stringify(res.simulation.err)}` : `Simulation succeeded${res.simulation?.unitsConsumed ? ` (${res.simulation.unitsConsumed} CU)` : ""}.`)}</span></div>
          {res.kind === "evm-txs" && <ol className="list-decimal pl-5">{res.transactions.map((t: any) => <li key={t.label}>{t.label}</li>)}</ol>}
          {(res.kind === "solana-tx" || res.kind === "evm-txs") && (signerMatches
            ? <Button size="sm" disabled={busy || !!sent} onClick={execute}>Sign in wallet ({res.kind === "evm-txs" ? `${res.transactions.length} tx` : "1 tx"})</Button>
            : <Notice tone="warn">Connect the treasury wallet <span className="num">{shortAddress(res.signer, 6, 6)}</span> to sign. Your current wallet cannot authorise this.</Notice>)}
          {res.kind === "safe-batch" && <div className="space-y-2"><Notice>Open <a className="text-brand" href={`https://app.safe.global/apps/open?safe=${getChain(s.chain)?.id === "ethereum" ? "eth" : getChain(s.chain)?.id}:${res.safe}&appUrl=https%3A%2F%2Fapps-portal.safe.global%2Ftx-builder`} target="_blank" rel="noopener noreferrer">Safe → Transaction Builder</a>, drop in this batch file, review each call, then collect the required owner signatures.</Notice><Button size="sm" variant="subtle" onClick={() => download(`sharebajar-safe-batch-${Date.now()}.json`, res.batch)}><Download size={13} /> Download Safe batch</Button></div>}
          {res.kind === "squads-instructions" && <div className="space-y-2"><Notice>Create a proposal in <a className="text-brand" href="https://app.squads.so" target="_blank" rel="noopener noreferrer">Squads</a> for multisig <span className="num">{shortAddress(res.multisig, 6, 6)}</span> using these instructions (vault {shortAddress(res.vault, 6, 6)}). Members review and approve in Squads.</Notice><Button size="sm" variant="subtle" onClick={() => download(`sharebajar-squads-${Date.now()}.json`, res)}><Download size={13} /> Download instructions</Button></div>}
          {sent && <div className="text-up">Submitted: <a className="num" href={`${getChain(s.chain)?.explorer.tx}${sent}`} target="_blank" rel="noopener noreferrer">{shortAddress(sent, 8, 6)}</a>. The indexer will record it as an outgoing transfer (not revenue).</div>}
          <Badge tone="neutral">Prepared by server · never signed by server</Badge>
        </div>
      )}
    </Card>
  );
}

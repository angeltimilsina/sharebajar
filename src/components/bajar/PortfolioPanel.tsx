"use client";
import { useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, Notice, Badge, Skeleton } from "../ui/primitives";
import { DataStatus } from "../ui/DataStatus";
import { usePoll } from "@/hooks/usePoll";
import { formatNumber, formatUsd } from "@/lib/format";
import { bajar } from "@/lib/bajar/session";
import { CHAINS } from "@/lib/chains";
import { customTokens, saveCustomTokens, type CustomToken } from "./customTokens";

export interface Holding { network: string; networkName: string; token: string; symbol: string; name: string; decimals: number; amountRaw: string; amount: number; usdPrice: number | null; usdValue: number | null; priceSource: string; native: boolean; wrappedBtc?: boolean; custom?: boolean }
export interface PortfolioData { holdings: Holding[]; totalUsd: number; errors: string[] }

export function usePortfolio(interval = 20_000) {
  const a = bajar.accounts()!;
  const [custom, setCustom] = useState<CustomToken[]>(() => customTokens());
  const url = `/api/wallet/portfolio?btc=${a.bitcoin.address}&evm=${a.evm.address}&sol=${a.solana.address}&custom=${encodeURIComponent(JSON.stringify(custom))}`;
  const poll = usePoll<PortfolioData>(url, interval);
  return { ...poll, custom, setCustom: (l: CustomToken[]) => { saveCustomTokens(l); setCustom(l); } };
}

export function PortfolioPanel({ onAction }: { onAction: (t: "send" | "receive" | "swap") => void }) {
  const p = usePortfolio();
  const holdings = p.data?.holdings ?? [];
  const nonZero = holdings.filter((h) => h.amount > 0);
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="text-xs text-muted">Total value (live)</div>
        <div className="text-3xl font-bold tabular-nums" data-testid="bajar-total">{p.data ? formatUsd(p.data.totalUsd) : <Skeleton className="h-9 w-40" />}</div>
        <div className="mt-1 flex items-center gap-2"><DataStatus expectedMs={20_000} fetchedAt={p.fetchedAt} source={p.source} stale={p.stale} error={p.error} /><button onClick={p.refresh} className="text-muted" aria-label="Refresh"><RefreshCw size={13} /></button></div>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => onAction("send")}>Send</Button>
          <Button variant="outline" onClick={() => onAction("receive")}>Receive</Button>
          <Button variant="outline" onClick={() => onAction("swap")}>Swap</Button>
        </div>
      </Card>
      {p.data?.errors.length ? <Notice tone="warn" title="Some networks did not respond">{p.data.errors.join(" · ")}</Notice> : null}
      <Card>
        <CardHeader title="Assets" sub="Balances read directly from each network. Prices from live exchange/on-chain sources." />
        <ul className="divide-y divide-line">
          {!p.data && Array.from({ length: 4 }, (_, i) => <li key={i} className="p-3"><Skeleton className="h-6" /></li>)}
          {p.data && !nonZero.length && <li className="p-4 text-sm text-muted">No balances yet. Use Receive to fund this wallet.</li>}
          {nonZero.map((h) => (
            <li key={h.network + h.token} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold flex items-center gap-1.5">{h.symbol}
                  <span className="text-[11px] text-muted font-normal">{h.networkName}</span>
                  {h.network === "bitcoin" && <Badge tone="brand">native BTC</Badge>}
                  {h.wrappedBtc && <Badge tone="warn" title="A token on another chain that represents BTC via a custodian or bridge. Not native bitcoin.">wrapped BTC</Badge>}
                  {h.custom && <Badge>custom</Badge>}
                </div>
                <div className="text-[11px] text-faint truncate" title={h.priceSource}>{h.usdPrice !== null ? `${formatUsd(h.usdPrice, h.usdPrice < 1 ? 4 : 2)} · ${h.priceSource}` : "No reliable price — not valued"}</div>
              </div>
              <div className="text-right tabular-nums">
                <div className="text-sm">{formatNumber(h.amount, h.amount < 1 ? 6 : 4)}</div>
                <div className="text-[11px] text-muted">{h.usdValue !== null ? formatUsd(h.usdValue) : "—"}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <CustomTokens list={p.custom} onChange={p.setCustom} />
    </div>
  );
}

function CustomTokens({ list, onChange }: { list: CustomToken[]; onChange: (l: CustomToken[]) => void }) {
  const [network, setNetwork] = useState("solana");
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Custom tokens" sub="Verified on-chain before adding. Stored only in this browser." />
      <div className="px-4 pb-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          <select className="rounded-lg border border-line bg-surface-2 px-2 py-2 text-sm" value={network} onChange={(e) => setNetwork(e.target.value)}>
            {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className="flex-1 min-w-0 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm font-mono" placeholder="Token contract / mint address" value={token} onChange={(e) => setToken(e.target.value.trim())} />
          <Button disabled={!token || busy} onClick={async () => {
            setErr(null); setBusy(true);
            try {
              const r = await fetch(`/api/wallet/token?network=${network}&token=${token}`); const b = await r.json();
              if (!r.ok) throw new Error(b.error);
              if (list.some((t) => t.network === network && t.token.toLowerCase() === token.toLowerCase())) throw new Error("Already added.");
              onChange([...list, { network, token: b.token, symbol: String(b.symbol).slice(0, 16), decimals: b.decimals }]); setToken("");
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}><Plus size={14} className="mr-1" />Add</Button>
        </div>
        {err && <p className="text-xs text-down">{err}</p>}
        {list.map((t) => (
          <div key={t.network + t.token} className="flex items-center gap-2 text-xs">
            <span className="font-semibold">{t.symbol}</span><span className="text-muted">{t.network}</span><span className="font-mono text-faint truncate flex-1">{t.token}</span>
            <button aria-label="Remove" onClick={() => onChange(list.filter((x) => x !== t))}><Trash2 size={13} className="text-muted" /></button>
          </div>
        ))}
      </div>
    </Card>
  );
}

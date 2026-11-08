"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, CardHeader } from "../ui/primitives";
import { usePoll } from "@/hooks/usePoll";
import { bajar } from "@/lib/bajar/session";
import { CHAINS } from "@/lib/chains";
import { customTokens, saveCustomTokens, type CustomToken } from "./customTokens";

export interface Holding { network: string; networkName: string; token: string; symbol: string; name: string; decimals: number; amountRaw: string; amount: number; usdPrice: number | null; usdValue: number | null; priceSource: string; native: boolean; wrappedBtc?: boolean; custom?: boolean; change24h?: number | null }
export interface PortfolioData { holdings: Holding[]; totalUsd: number; errors: string[] }

export function usePortfolio(interval = 20_000) {
  const a = bajar.accounts()!;
  const [custom, setCustom] = useState<CustomToken[]>(() => customTokens());
  const url = `/api/wallet/portfolio?btc=${a.bitcoin.address}&evm=${a.evm.address}&sol=${a.solana.address}&custom=${encodeURIComponent(JSON.stringify(custom))}`;
  const poll = usePoll<PortfolioData>(url, interval);
  return { ...poll, custom, setCustom: (l: CustomToken[]) => { saveCustomTokens(l); setCustom(l); } };
}

export function CustomTokens({ list, onChange }: { list: CustomToken[]; onChange: (l: CustomToken[]) => void }) {
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

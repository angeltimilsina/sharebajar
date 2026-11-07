"use client";
import { useEffect, useState } from "react";
import { useStreamStatus } from "@/hooks/useBinance";
import { Badge, Card, CardHeader } from "../ui/primitives";
import { timeAgo } from "@/lib/format";

interface Health {
  status: string; time: number; uptimeSec: number;
  integrations: { ai: { configured: boolean }; coingeckoKey: boolean; solanaRpc: string; evmSwaps: { configured: boolean; note: string }; limitOrders: { configured: boolean; note: string } };
  upstreams: { host: string; ok: number; failed: number; lastStatus: number | null; lastLatencyMs: number | null; lastError: string | null; lastAt: number | null }[];
}

export function StatusView() {
  const [h, setH] = useState<Health | null>(null);
  const ws = useStreamStatus();
  useEffect(() => {
    const load = () => fetch("/api/health").then((r) => r.json()).then(setH).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  const row = (label: string, ok: boolean | null, detail: string) => (
    <li className="flex items-center gap-3 py-2 border-b border-line/60 last:border-0">
      <span className={`h-2 w-2 rounded-full ${ok === null ? "bg-faint" : ok ? "bg-up" : "bg-warn"}`} />
      <span className="flex-1 font-medium text-sm">{label}</span>
      <span className="text-xs text-muted">{detail}</span>
    </li>
  );
  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-2xl font-bold">System status</h1>
      <Card>
        <CardHeader title="Integrations" />
        <ul className="px-4 pb-3">
          {row("Market data (CoinGecko)", true, h?.integrations.coingeckoKey ? "API key configured" : "Public tier (rate-limited)")}
          {row("Live price stream (Binance WebSocket)", ws === "open", ws)}
          {row("ShareBajar Intelligence (AI)", h ? h.integrations.ai.configured : null, h?.integrations.ai.configured ? "Configured" : "Not configured")}
          {row("Solana swaps (Jupiter)", true, "Enabled")}
          {row("Solana RPC", h ? h.integrations.solanaRpc === "custom" : null, h?.integrations.solanaRpc ?? "…")}
          {row("EVM swaps", false, h?.integrations.evmSwaps.note ?? "…")}
          {row("Limit orders", false, h?.integrations.limitOrders.note ?? "…")}
          {row("BAJAR Wallet", false, "Upcoming")}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Upstream APIs (this server instance)" sub={h ? `Uptime ${Math.round(h.uptimeSec / 60)} min` : undefined} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted border-y border-line"><tr><th className="text-left px-4 py-2 font-medium">Host</th><th className="text-right px-3 font-medium">OK</th><th className="text-right px-3 font-medium">Failed</th><th className="text-right px-3 font-medium">Last</th><th className="text-right px-3 font-medium">Latency</th><th className="text-right px-4 font-medium">When</th></tr></thead>
            <tbody>
              {h?.upstreams.map((u) => (
                <tr key={u.host} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2 num text-xs">{u.host}</td>
                  <td className="px-3 text-right num">{u.ok}</td>
                  <td className="px-3 text-right num">{u.failed}</td>
                  <td className="px-3 text-right">{u.lastStatus === 200 ? <Badge tone="up">200</Badge> : <Badge tone="warn" title={u.lastError ?? ""}>{u.lastStatus ?? "ERR"}</Badge>}</td>
                  <td className="px-3 text-right num text-xs">{u.lastLatencyMs ?? "—"} ms</td>
                  <td className="px-4 text-right text-xs text-muted">{timeAgo(u.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!h?.upstreams.length && <div className="p-6 text-xs text-muted text-center">No upstream calls recorded yet.</div>}
        </div>
      </Card>
    </div>
  );
}

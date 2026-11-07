"use client";
import Link from "next/link";
import { Activity, Blocks, Fuel, Clock } from "lucide-react";
import { usePoll } from "@/hooks/usePoll";
import { useLiveTickers } from "@/hooks/useBinance";
import { useNow } from "@/hooks/useNow";
import { formatNumber, formatPrice, timeAgo } from "@/lib/format";
import type { NetworkStat } from "@/lib/market/networks";
import { Card, Pct, Skeleton } from "../ui/primitives";
import { ChainIcon } from "../ui/ChainIcon";
import { DataStatus } from "../ui/DataStatus";

const fee = (f: NetworkStat["fee"]) => {
  if (!f) return "—";
  const v = f.unit === "gwei" ? (f.value < 0.01 ? f.value.toFixed(4) : f.value < 1 ? f.value.toFixed(3) : f.value.toFixed(1)) : formatNumber(f.value, 0);
  return `${v} ${f.unit}`;
};

/** Live conditions on each blockchain, read directly from the chains. */
export function NetworkPulse() {
  const s = usePoll<NetworkStat[]>("/api/networks", 15_000);
  const live = useLiveTickers([...new Set((s.data ?? []).map((n) => n.pair))]);
  const now = useNow(5000);
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Activity size={16} className="text-brand" /> Network Pulse</h2>
        <DataStatus fetchedAt={s.fetchedAt} expectedMs={15_000} stale={s.stale} error={s.error} source="mempool.space · JSON-RPC nodes" />
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-4">
        {!s.data && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[118px] min-w-[220px]" />)}
        {s.data?.map((n) => {
          const t = live[n.pair];
          const href = n.id === "bitcoin" ? "/coin/bitcoin" : `/discover?network=${n.id}`;
          return (
            <Link key={n.id} href={href} className="min-w-[220px] flex-1 rounded-xl border border-line bg-surface-2/60 hover:bg-surface-2 p-3 text-xs">
              <div className="flex items-center gap-2">
                <ChainIcon chain={n.id} size={18} />
                <span className="font-semibold text-sm">{n.name}</span>
                <span className="flex-1" />
                {t ? <span className="num text-right"><span className="block font-semibold text-[13px]">{formatPrice(t.price)}</span><Pct v={t.change24h} className="text-[10.5px]" /></span> : <span className="text-faint">{n.symbol}</span>}
              </div>
              {n.error ? (
                <div className="mt-3 text-down">Node unavailable</div>
              ) : (
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 num">
                  <div><dt className="text-faint flex items-center gap-1 whitespace-nowrap"><Blocks size={11} />{n.id === "solana" ? "Slot" : "Block"}</dt><dd className="font-medium">{n.height?.toLocaleString() ?? "—"}</dd></div>
                  <div><dt className="text-faint flex items-center gap-1 whitespace-nowrap"><Fuel size={11} />{n.fee?.label ?? "Fee"}</dt><dd className="font-medium truncate" title={fee(n.fee)}>{fee(n.fee)}</dd></div>
                  <div><dt className="text-faint flex items-center gap-1 whitespace-nowrap"><Activity size={11} />Throughput</dt><dd className="font-medium whitespace-nowrap" title={n.id === "solana" ? "Non-vote transactions per second" : undefined}>{n.throughput ? `${n.throughput.value.toLocaleString()} ${n.throughput.unit}` : "—"}</dd></div>
                  <div><dt className="text-faint flex items-center gap-1 whitespace-nowrap"><Clock size={11} />{n.pending !== null ? "Mempool" : "Last block"}</dt><dd className="font-medium">{n.pending !== null ? `${n.pending.toLocaleString()} txs` : n.id === "solana" ? "live" : now && n.blockTime ? timeAgo(n.blockTime, now) : "—"}</dd></div>
                </dl>
              )}
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

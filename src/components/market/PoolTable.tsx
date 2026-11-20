"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatUsd, age } from "@/lib/format";
import { useNow } from "@/hooks/useNow";
import { poolSignals } from "@/lib/analytics/signals";
import type { Pool } from "@/lib/types";
import { Badge, Pct, Skeleton } from "../ui/primitives";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainIcon } from "../ui/ChainIcon";
import { PriceCell } from "./PriceCell";
import { WatchStar } from "./WatchStar";

export function PoolTable({ pools, loading, emptyText, showSignals = true, error }: { pools: Pool[]; loading?: boolean; emptyText?: string; showSignals?: boolean; error?: string | null }) {
  const router = useRouter();
  const now = useNow(10_000);
  if (error && !pools.length) return <div className="p-10 text-center text-sm"><div className="text-down">Pool data unavailable</div><div className="text-xs text-muted mt-1">{error} — retrying automatically.</div></div>;
  if (loading && !pools.length) return <div className="p-4 space-y-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (!pools.length) return <div className="p-10 text-center text-sm text-muted">{emptyText ?? "No pools to show."}</div>;
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full text-sm min-w-[960px]">
        <thead className="text-xs text-muted border-b border-line">
          <tr>
            <th className="w-10" />
            <th className="px-3 py-2.5 font-medium text-left">Pair</th>
            <th className="px-3 py-2.5 font-medium text-right">Price</th>
            <th className="px-3 py-2.5 font-medium text-right">Age</th>
            <th className="px-3 py-2.5 font-medium text-right">5m</th>
            <th className="px-3 py-2.5 font-medium text-right">1h</th>
            <th className="px-3 py-2.5 font-medium text-right">24h</th>
            <th className="px-3 py-2.5 font-medium text-right">Volume 24h</th>
            <th className="px-3 py-2.5 font-medium text-right">Liquidity</th>
            <th className="px-3 py-2.5 font-medium text-right">FDV</th>
            <th className="px-3 py-2.5 font-medium text-right">Txns 24h</th>
            {showSignals && <th className="px-3 py-2.5 font-medium text-left">Signals</th>}
          </tr>
        </thead>
        <tbody>
          {pools.map((p) => {
            const href = `/token/${p.network}/${p.base.address}?pair=${p.address}`;
            const sig = showSignals ? poolSignals(p, now || Date.now()).slice(0, 2) : [];
            return (
              <tr key={p.id} onClick={() => router.push(href)} className="border-b border-line/60 last:border-0 hover:bg-surface-2/70 cursor-pointer">
                <td className="pl-4 pr-1 py-3"><WatchStar item={{ kind: "token", id: p.base.address, chain: p.network, address: p.base.address, label: p.base.symbol }} /></td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="relative">
                      <TokenIcon src={p.base.image} symbol={p.base.symbol} size={28} />
                      <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[1px]"><ChainIcon chain={p.network} size={12} /></span>
                    </div>
                    <div className="min-w-0">
                      <Link href={href} onClick={(e) => e.stopPropagation()} className="block font-semibold truncate max-w-[180px] hover:underline underline-offset-2">{p.base.symbol}<span className="text-muted font-normal">/{p.quote.symbol}</span></Link>
                      <div className="text-[11px] text-muted truncate max-w-[180px]">{p.base.name} · {p.dex}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-right"><PriceCell value={p.priceUsd} /></td>
                <td className="px-3 py-3 text-right text-muted num">{(now ? age(p.createdAt, now) : "")}</td>
                <td className="px-3 py-3 text-right"><Pct v={p.change.m5} /></td>
                <td className="px-3 py-3 text-right"><Pct v={p.change.h1} /></td>
                <td className="px-3 py-3 text-right"><Pct v={p.change.h24} /></td>
                <td className="px-3 py-3 text-right num">{formatUsd(p.volume.h24)}</td>
                <td className="px-3 py-3 text-right num">{formatUsd(p.reserveUsd)}</td>
                <td className="px-3 py-3 text-right num">{formatUsd(p.fdv)}</td>
                <td className="px-3 py-3 text-right num text-xs"><span className="text-up">{p.txns.h24.buys}</span><span className="text-faint"> / </span><span className="text-down">{p.txns.h24.sells}</span></td>
                {showSignals && <td className="px-3 py-3"><div className="flex gap-1 flex-wrap">{sig.map((s) => <Badge key={s.label} tone={s.tone === "up" ? "up" : s.tone === "down" ? "down" : s.tone === "warn" ? "warn" : "info"} title={s.detail}>{s.label}</Badge>)}</div></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

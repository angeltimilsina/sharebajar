"use client";
import { useEffect, useState } from "react";
import { formatUsd } from "@/lib/format";
import { Pct, Skeleton } from "../ui/primitives";
import { Sparkline } from "../ui/Sparkline";
import { DataStatus } from "../ui/DataStatus";
import type { Envelope, GlobalStats, TvlStats } from "@/lib/types";

type Part<T> = Envelope<T> | { error: string };
export interface Overview { global: Part<GlobalStats>; tvl: Part<TvlStats> }
const has = <T,>(p: Part<T> | undefined): p is Envelope<T> => !!p && "data" in p;

function CoinBadge({ color, children }: { color: string; children: React.ReactNode }) {
  return <span className="h-10 w-10 rounded-full grid place-items-center text-white font-bold text-lg shrink-0" style={{ background: color, boxShadow: `0 0 20px -4px ${color}` }}>{children}</span>;
}

export function StatCards({ initial }: { initial: Overview | null }) {
  const [ov, setOv] = useState<Overview | null>(initial);
  useEffect(() => {
    const load = () => fetch("/api/market/overview").then((r) => r.json()).then(setOv).catch(() => {});
    const t = setInterval(load, 60_000);
    if (!initial) load();
    return () => clearInterval(t);
  }, [initial]);

  const g = has(ov?.global) ? ov!.global : null;
  const t = has(ov?.tvl) ? ov!.tvl : null;
  const gErr = ov && !has(ov.global) ? (ov.global as { error: string }).error : null;

  const card = "panel px-4 py-3.5 min-w-0";
  const val = "num text-[22px] sm:text-[24px] font-bold tracking-tight";
  return (
    <section className="grid gap-3 grid-cols-2 lg:grid-cols-5" aria-label="Market overview">
      <div className={card}>
        <div className="flex items-center justify-between text-xs text-muted">Total Market Cap {g && <DataStatus compact fetchedAt={g.fetchedAt} expectedMs={120_000} stale={g.stale} source={g.source} />}</div>
        <div className="mt-1.5 flex items-end gap-2 flex-wrap">{g ? <><span className={val}>{formatUsd(g.data.totalMarketCap)}</span><Pct v={g.data.marketCapChange24h} className="text-xs mb-1" /></> : gErr ? <span className="text-xs text-down">{gErr}</span> : <Skeleton className="h-7 w-32" />}</div>
      </div>
      <div className={card}>
        <div className="text-xs text-muted">24h Trading Volume</div>
        <div className="mt-1.5 flex items-end gap-2">{g ? <span className={val}>{formatUsd(g.data.totalVolume)}</span> : gErr ? <span className="text-xs text-down">Unavailable</span> : <Skeleton className="h-7 w-32" />}</div>
        {g && <div className="text-[11px] text-faint mt-0.5">{g.data.markets.toLocaleString()} markets tracked</div>}
      </div>
      <div className={`${card} flex items-center justify-between gap-2`}>
        <div className="min-w-0">
          <div className="text-xs text-muted">DeFi TVL</div>
          <div className="mt-1.5 flex items-end gap-2 flex-wrap">{t ? <><span className={val}>{formatUsd(t.data.tvl)}</span><Pct v={t.data.change24h} className="text-xs mb-1" /></> : ov && !t ? <span className="text-xs text-down">Unavailable</span> : <Skeleton className="h-7 w-32" />}</div>
          {t && <div className="text-[11px] text-faint mt-0.5">DefiLlama · 30d</div>}
        </div>
        {t && <Sparkline data={t.data.series} width={90} height={38} className="hidden sm:block shrink-0" />}
      </div>
      <div className={`${card} flex items-center gap-3`}>
        <CoinBadge color="#F7931A">₿</CoinBadge>
        <div><div className="text-xs text-muted">BTC Dominance</div><div className={val}>{g ? `${g.data.btcDominance.toFixed(2)}%` : gErr ? "—" : <Skeleton className="h-7 w-20" />}</div></div>
      </div>
      <div className={`${card} flex items-center gap-3 col-span-2 lg:col-span-1`}>
        <CoinBadge color="#627EEA">Ξ</CoinBadge>
        <div><div className="text-xs text-muted">ETH Dominance</div><div className={val}>{g ? `${g.data.ethDominance.toFixed(2)}%` : gErr ? "—" : <Skeleton className="h-7 w-20" />}</div></div>
      </div>
    </section>
  );
}

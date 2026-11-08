"use client";
import Link from "next/link";
import { ArrowRight, Flame, RefreshCw, Rocket } from "lucide-react";
import { usePoll } from "@/hooks/usePoll";
import { useNow } from "@/hooks/useNow";
import { formatPrice, timeAgo } from "@/lib/format";
import { getChain } from "@/lib/chains";
import type { NewsItem, Pool } from "@/lib/types";
import { Card, CardHeader, Pct, Skeleton } from "../ui/primitives";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainLabel } from "../ui/ChainIcon";
import { DataStatus } from "../ui/DataStatus";

const viewAll = (href: string) => <Link href={href} className="text-xs font-medium text-brand inline-flex items-center gap-1 hover:underline">View All <ArrowRight size={12} /></Link>;

export function TrendingTokens({ network }: { network: string }) {
  const q = network === "all" ? "" : `&network=${network}`;
  const s = usePoll<Pool[]>(`/api/dex/pools?feed=trending&duration=1h${q}`, 60_000);
  return (
    <Card>
      <CardHeader title="Trending Tokens" icon={<Flame size={16} className="text-orange-400" />} action={viewAll(`/discover?feed=trending${q}`)} sub={<DataStatus fetchedAt={s.fetchedAt} expectedMs={60_000} stale={s.stale} error={s.error} source="GeckoTerminal" />} />
      <ol className="px-2 pb-2">
        {s.loading && !s.data && Array.from({ length: 5 }).map((_, i) => <li key={i} className="px-2 py-2"><Skeleton className="h-6" /></li>)}
        {s.error && !s.data && <li className="px-3 py-4 text-xs text-down">{s.error}</li>}
        {s.data?.slice(0, 5).map((p, i) => (
          <li key={p.id}>
            <Link href={`/token/${p.network}/${p.base.address}`} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-surface-2">
              <span className="w-4 text-xs text-muted num">{i + 1}</span>
              <TokenIcon src={p.base.image} symbol={p.base.symbol} size={26} />
              <span className="flex-1 min-w-0"><span className="font-semibold text-sm truncate block">{p.base.symbol}</span><span className="text-[11px] text-muted">{getChain(p.network)?.name ?? p.network}</span></span>
              <span className="text-right"><span className="num text-sm block">{formatPrice(p.priceUsd)}</span><Pct v={p.change.h24} className="text-xs" digits={1} /></span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function NewlyLaunched({ network }: { network: string }) {
  const q = network === "all" ? "" : `&network=${network}`;
  const s = usePoll<Pool[]>(`/api/dex/pools?feed=new${q}`, 30_000);
  const now = useNow(5000);
  return (
    <Card>
      <CardHeader title="Newly Launched" icon={<RefreshCw size={14} className={`text-brand ${s.loading ? "animate-spin" : ""}`} />} action={viewAll(`/launchpad${network === "all" ? "" : `?network=${network}`}`)} sub={<DataStatus fetchedAt={s.fetchedAt} expectedMs={30_000} stale={s.stale} error={s.error} source="GeckoTerminal" />} />
      <ul className="px-2 pb-2">
        {s.loading && !s.data && Array.from({ length: 5 }).map((_, i) => <li key={i} className="px-2 py-2"><Skeleton className="h-6" /></li>)}
        {s.error && !s.data && <li className="px-3 py-4 text-xs text-down">{s.error}</li>}
        {s.data?.slice(0, 5).map((p) => (
          <li key={p.id}>
            <Link href={`/token/${p.network}/${p.base.address}`} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-surface-2">
              <TokenIcon src={p.base.image} symbol={p.base.symbol} size={26} />
              <span className="font-semibold text-sm truncate max-w-[110px]">${p.base.symbol}</span>
              <ChainLabel chain={p.network} className="flex-1" />
              <span className="text-xs text-muted num">{(now ? timeAgo(p.createdAt, now) : "")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function MarketNews({ limit = 4, query }: { limit?: number; query?: string }) {
  const s = usePoll<NewsItem[]>(`/api/news?limit=${limit}${query ? `&q=${encodeURIComponent(query)}` : ""}`, 300_000);
  const now = useNow(30_000);
  return (
    <Card>
      <CardHeader title={query ? "Related News" : "Market News"} action={!query ? viewAll("/intelligence#news") : undefined} sub={<DataStatus fetchedAt={s.fetchedAt} expectedMs={300_000} stale={s.stale} error={s.error} />} />
      <ul className="px-2 pb-2">
        {s.loading && !s.data && Array.from({ length: limit }).map((_, i) => <li key={i} className="px-2 py-2"><Skeleton className="h-12" /></li>)}
        {s.error && !s.data && <li className="px-3 py-4 text-xs text-down">{s.error}</li>}
        {s.data && !s.data.length && <li className="px-3 py-4 text-xs text-muted">No recent coverage found.</li>}
        {s.data?.map((n) => (
          <li key={n.id}>
            <a href={n.url} target="_blank" rel="noopener noreferrer" className="flex gap-3 px-2 py-2 rounded-lg hover:bg-surface-2">
              {n.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={n.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} className="h-14 w-14 rounded-lg object-cover shrink-0 bg-surface-3" />
              ) : <span className="h-14 w-14 rounded-lg bg-surface-3 shrink-0 grid place-items-center text-[10px] text-muted">{n.source}</span>}
              <span className="min-w-0">
                <span className="text-[13px] font-medium leading-snug line-clamp-2">{n.title}</span>
                <span className="text-[11px] text-muted">{(now ? timeAgo(n.publishedAt, now) : "")} · {n.source}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function LaunchpadCard() {
  return (
    <Card>
      <CardHeader title="Launchpad" icon={<Rocket size={15} className="text-ai" />} action={viewAll("/launchpad")} />
      <div className="mx-3 mb-3 rounded-xl p-4 relative overflow-hidden border border-ai/25" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--ai) 28%, var(--surface)), var(--surface-2))" }}>
        <div className="relative z-10 max-w-[70%]">
          <div className="font-semibold">Launch your token on Bajar</div>
          <p className="text-xs text-muted mt-1">Create, list, and grow your project across multiple chains.</p>
          <Link href="/launchpad#create" className="mt-3 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg btn-silver text-xs font-semibold">Create Token <ArrowRight size={13} /></Link>
        </div>
        <Rocket size={72} className="absolute right-3 bottom-2 text-ai opacity-70 -rotate-12" />
      </div>
    </Card>
  );
}

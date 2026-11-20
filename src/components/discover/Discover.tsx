"use client";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { usePoll } from "@/hooks/usePoll";
import { detectAddress, getChain } from "@/lib/chains";
import { formatUsd, formatPrice } from "@/lib/format";
import type { DexPair, Pool } from "@/lib/types";
import type { TokenProfile } from "@/lib/market/dexscreener";
import { Badge, Button, Card, Pct, Tabs } from "../ui/primitives";
import { DataStatus } from "../ui/DataStatus";
import { NetworkFilter } from "../market/NetworkFilter";
import { PoolTable } from "../market/PoolTable";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainLabel } from "../ui/ChainIcon";

type Feed = "trending" | "new" | "top" | "profiles" | "boosts";
const FEEDS: { id: Feed; label: string }[] = [
  { id: "trending", label: "Trending" }, { id: "new", label: "New Pools" }, { id: "top", label: "Top Volume" },
  { id: "profiles", label: "Latest Profiles" }, { id: "boosts", label: "Boosted" },
];

import { applyFilters, EMPTY_FILTERS as EMPTY, type Filters } from "@/lib/analytics/filters";

export function Discover() {
  const sp = useSearchParams();
  const router = useRouter();
  const [network, setNetwork] = useState(sp.get("network") ?? "solana");
  const [feed, setFeed] = useState<Feed>((FEEDS.find((f) => f.id === sp.get("feed"))?.id) ?? "trending");
  const [duration, setDuration] = useState<"5m" | "1h" | "6h" | "24h">("1h");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  const [q, setQ] = useState("");
  const chain = getChain(network);
  const isPoolFeed = feed === "trending" || feed === "new" || feed === "top";
  const poolUrl = isPoolFeed ? `/api/dex/pools?feed=${feed}&duration=${duration}${chain ? `&network=${chain.id}` : feed === "top" ? "&network=solana" : ""}` : null;
  const pools = usePoll<Pool[]>(poolUrl, feed === "new" ? 20_000 : 45_000);
  const profiles = usePoll<(TokenProfile & { pair: DexPair | null })[]>(!isPoolFeed ? `/api/dex/profiles?kind=${feed === "boosts" ? "boosts" : "latest"}${chain ? `&network=${chain.id}` : ""}` : null, 30_000);
  const filtered = useMemo(() => applyFilters(pools.data ?? [], filters), [pools.data, filters]);
  const activeFilters = Object.entries(filters).filter(([, v]) => v !== "" && v !== false).length;

  const lookup = (e: React.FormEvent) => {
    e.preventDefault();
    const a = detectAddress(q);
    if (a) {
      const target = a.chainType === "solana" ? "solana" : chain?.type === "evm" ? chain.id : null;
      if (target) router.push(`/token/${target}/${a.address}`);
      else window.dispatchEvent(new Event("sb-open-search"));
    } else window.dispatchEvent(new Event("sb-open-search"));
  };

  const field = (k: keyof Filters, label: string, placeholder: string) => (
    <label className="text-xs text-muted space-y-1">
      <span>{label}</span>
      <input inputMode="decimal" value={filters[k] as string} onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value.replace(/[^0-9.\-]/g, "") }))} placeholder={placeholder} className="w-full h-10 rounded-xl bg-surface-2 px-3 text-[16px] sm:text-sm text-fg outline-none focus:ring-2 focus:ring-brand/40" />
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-[30px] sm:text-[34px] leading-tight">Discover</h1>
          <p className="text-[14.5px] text-muted mt-1">Live on-chain pools on {chain ? chain.name : "every supported network"} — trending, new and high-volume, with risk signals.</p>
        </div>
        <div className="flex-1" />
        <form onSubmit={lookup} className="flex items-center gap-2 w-full sm:w-auto">
          <label className="flex items-center gap-2 h-11 rounded-xl bg-surface-2 px-3 flex-1 sm:w-[380px]">
            <Search size={16} className="text-muted shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Paste a contract address" className="no-ring bg-transparent outline-none text-[16px] flex-1 min-w-0 num placeholder:text-faint" aria-label="Contract address" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
          </label>
          <Button type="submit" className="h-11">Look up</Button>
        </form>
      </div>
      <NetworkFilter value={network} onChange={setNetwork} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-2 sm:px-3">
          <Tabs tabs={FEEDS} value={feed} onChange={setFeed} />
          <div className="flex-1" />
          {feed === "trending" && <Tabs size="sm" tabs={(["5m", "1h", "6h", "24h"] as const).map((d) => ({ id: d, label: d }))} value={duration} onChange={setDuration} />}
          {isPoolFeed && (
            <button onClick={() => setShowFilters((s) => !s)} className={`h-8 px-3.5 my-1.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 ${activeFilters ? "bg-brand-soft text-brand" : "bg-surface-2 text-muted hover:text-fg"}`}>
              <SlidersHorizontal size={13} /> Filters{activeFilters ? ` (${activeFilters})` : ""}
            </button>
          )}
          <div className="pr-1">{isPoolFeed ? <DataStatus fetchedAt={pools.fetchedAt} expectedMs={feed === "new" ? 20_000 : 45_000} stale={pools.stale} error={pools.error} source="GeckoTerminal" /> : <DataStatus fetchedAt={profiles.fetchedAt} expectedMs={30_000} stale={profiles.stale} error={profiles.error} source="DexScreener" />}</div>
        </div>
        {isPoolFeed && showFilters && (
          <div className="border-b border-line p-4 grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 items-end bg-surface-2/40">
            {field("minLiq", "Min liquidity ($)", "10000")}
            {field("minVol", "Min 24h volume ($)", "50000")}
            {field("minFdv", "Min FDV ($)", "")}
            {field("maxFdv", "Max FDV ($)", "")}
            {field("maxAgeH", "Max age (hours)", "24")}
            {field("minChange", "Min 24h change (%)", "")}
            {field("maxChange", "Max 24h change (%)", "")}
            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted flex items-center gap-2"><input type="checkbox" className="accent-[var(--brand)]" checked={filters.hideThin} onChange={(e) => setFilters((f) => ({ ...f, hideThin: e.target.checked }))} /> Hide &lt;$10K liquidity</label>
              <button onClick={() => setFilters(EMPTY)} className="text-xs text-muted hover:text-fg inline-flex items-center gap-1"><X size={12} /> Reset</button>
            </div>
          </div>
        )}
        {feed === "top" && !chain && <div className="px-4 pt-3 text-xs text-muted">Top volume requires a network — showing Solana.</div>}
        {isPoolFeed ? (
          <>
            <PoolTable pools={filtered} loading={pools.loading} error={pools.error} emptyText={activeFilters ? "No pools match your filters." : "No pools right now."} />
            {pools.data && <div className="px-4 py-2 text-[11px] text-faint border-t border-line">{filtered.length} of {pools.data.length} pools shown · Signals are automated heuristics, not recommendations.</div>}
          </>
        ) : (
          <ProfileTable items={profiles.data ?? []} loading={profiles.loading} error={profiles.error} />
        )}
      </Card>
    </div>
  );
}

function ProfileTable({ items, loading, error }: { items: (TokenProfile & { pair: DexPair | null })[]; loading: boolean; error: string | null }) {
  if (error && !items.length) return <div className="p-10 text-center text-sm text-down">{error}</div>;
  if (loading && !items.length) return <div className="p-10 text-center text-sm text-muted">Loading…</div>;
  if (!items.length) return <div className="p-10 text-center text-sm text-muted">No tokens to show.</div>;
  return (
    <ul className="divide-y divide-line/60">
      {items.map((t) => (
        <li key={`${t.chain}:${t.address}`}>
          <Link href={`/token/${t.chain}/${t.address}${t.pair?.pairAddress ? `?pair=${t.pair.pairAddress}` : ""}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/70">
            <TokenIcon src={t.icon ?? t.pair?.imageUrl} symbol={t.pair?.base.symbol ?? "?"} size={32} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="font-semibold">{t.pair?.base.symbol ?? t.address.slice(0, 6)}</span><span className="text-xs text-muted truncate">{t.pair?.base.name}</span><ChainLabel chain={t.chain} />{t.boostAmount ? <Badge tone="warn">Boost {t.boostAmount}</Badge> : null}</div>
              {t.description && <p className="text-xs text-muted truncate max-w-2xl">{t.description}</p>}
            </div>
            {t.pair ? (
              <div className="hidden sm:grid grid-cols-4 gap-6 text-right text-sm num">
                <span>{formatPrice(t.pair.priceUsd)}</span>
                <Pct v={t.pair.change.h24} />
                <span className="text-muted">Liq {formatUsd(t.pair.liquidityUsd)}</span>
                <span className="text-muted">Vol {formatUsd(t.pair.volume.h24)}</span>
              </div>
            ) : <span className="text-xs text-faint">No pool data yet</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

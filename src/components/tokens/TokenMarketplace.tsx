"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Flame, Rocket, Sparkles, TrendingUp, Droplets, Clock } from "lucide-react";
import clsx from "clsx";
import type { Pool } from "@/lib/types";
import { age, formatPrice, formatUsd, timeAgo } from "@/lib/format";
import { useNow } from "@/hooks/useNow";
import { Badge, Card, CardHeader, Notice, Pct, Skeleton, Tabs } from "../ui/primitives";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainIcon } from "../ui/ChainIcon";
import { PoolTable } from "../market/PoolTable";

type Feed = "trending" | "new" | "top";
type Tab = "new" | "best" | "pools";

/** Networks shown on the marketplace. "evm" groups Ethereum and BNB Chain. */
const NETS = [
  { id: "all", label: "All", chains: ["solana", "base", "ethereum", "bsc"] },
  { id: "solana", label: "Solana", chains: ["solana"] },
  { id: "base", label: "Base", chains: ["base"] },
  { id: "evm", label: "EVM", chains: ["ethereum", "bsc"] },
] as const;
type Net = (typeof NETS)[number]["id"];

const MIN_LIQ = 25_000; // "best performing" ignores pools too thin to trade

/** Pools for several networks from Bajar's GeckoTerminal relay, merged and refreshed. */
function usePools(chains: readonly string[], feed: Feed, duration: "1h" | "24h", every = 30_000) {
  const key = `${feed}|${duration}|${chains.join(",")}`;
  const [state, setState] = useState<{ key: string; pools: Pool[]; loading: boolean; error: string | null; at: number | null }>({ key: "", pools: [], loading: true, error: null, at: null });
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const res = await Promise.allSettled(chains.map(async (c) => {
        const r = await fetch(`/api/dex/pools?feed=${feed}&duration=${duration}&network=${c}`);
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
        return (b.data ?? []) as Pool[];
      }));
      if (!alive) return;
      const ok = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const err = res.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      // Interleave networks so "All" isn't just the first network's list.
      const merged: Pool[] = [];
      const seen = new Set<string>();
      for (let i = 0; ok.some((l) => i < l.length); i++) for (const l of ok) {
        const p = l[i];
        if (p && !seen.has(p.id)) { seen.add(p.id); merged.push(p); }
      }
      setState((s) => ({ key, pools: ok.length ? merged : s.key === key ? s.pools : [], loading: false, error: ok.length ? null : String(err?.reason?.message ?? "Unavailable"), at: Date.now() }));
    };
    setState((s) => ({ ...s, loading: true }));
    run();
    const t = setInterval(() => { if (document.visibilityState === "visible") run(); }, every);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function TokenMarketplace() {
  const sp = useSearchParams();
  const router = useRouter();
  const [net, setNet] = useState<Net>((NETS.find((n) => n.id === sp.get("network"))?.id) ?? "all");
  const [tab, setTab] = useState<Tab>((["new", "best", "pools"] as Tab[]).find((t) => t === sp.get("tab")) ?? "new");
  const update = (n: Net, t: Tab) => {
    setNet(n); setTab(t);
    const q = new URLSearchParams();
    if (n !== "all") q.set("network", n);
    if (t !== "new") q.set("tab", t);
    router.replace(`/tokens${q.size ? `?${q}` : ""}`, { scroll: false });
  };
  const chains = NETS.find((n) => n.id === net)!.chains;

  return (
    <div className="space-y-5" data-testid="token-marketplace">
      <span data-app-page hidden />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[30px] sm:text-[34px] leading-tight">Tokens</h1>
          <p className="text-muted text-[14.5px] mt-1">New launches, the best performers and the deepest pools on Solana, Base and EVM networks. Live from on-chain DEX data.</p>
        </div>
        <Link href="/launchpad#create" className="btn-ink h-10 px-4 rounded-full inline-flex items-center gap-2 text-[14px] font-semibold"><Rocket size={15} /> Launch a token</Link>
      </div>

      {/* Trending launches */}
      <section aria-label="Trending launches" className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-3 px-3 sm:mx-0 sm:px-0 md:grid md:grid-cols-3 md:overflow-visible" data-testid="trending-launches">
        <TrendingColumn title="Trending on Solana" chains={["solana"]} icon="solana" accent="from-[#9945ff]/25" />
        <TrendingColumn title="Trending on Base" chains={["base"]} icon="base" accent="from-[#0052ff]/25" />
        <TrendingColumn title="Trending on EVM" sub="Ethereum · BNB Chain" chains={["ethereum", "bsc"]} icon="ethereum" accent="from-[#627eea]/25" />
      </section>

      {/* Browse */}
      <Card>
        <div className="p-4 sm:p-5 flex flex-wrap items-center gap-3">
          <Tabs<Tab>
            value={tab}
            onChange={(t) => update(net, t)}
            tabs={[
              { id: "new", label: <span className="inline-flex items-center gap-1.5"><Clock size={14} />New launches</span> },
              { id: "best", label: <span className="inline-flex items-center gap-1.5"><TrendingUp size={14} />Best performing</span> },
              { id: "pools", label: <span className="inline-flex items-center gap-1.5"><Droplets size={14} />Liquidity pools</span> },
            ]}
          />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar" role="radiogroup" aria-label="Network">
            {NETS.map((n) => (
              <button key={n.id} role="radio" aria-checked={net === n.id} onClick={() => update(n.id, tab)} data-testid={`net-${n.id}`}
                className={clsx("h-9 shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-medium transition-colors", net === n.id ? "border-brand/50 bg-brand-soft text-fg" : "border-line bg-surface hover:bg-surface-2 text-fg/90")}>
                {n.id !== "all" && <ChainIcon chain={n.id === "evm" ? "ethereum" : n.id} size={16} />}{n.label}
              </button>
            ))}
          </div>
        </div>
        {tab === "new" && <NewLaunches chains={chains} />}
        {tab === "best" && <BestPerforming chains={chains} />}
        {tab === "pools" && <LiquidityPools chains={chains} />}
      </Card>

      <BajarLaunches />
    </div>
  );
}

function TrendingColumn({ title, sub, chains, icon, accent }: { title: string; sub?: string; chains: string[]; icon: string; accent: string }) {
  const { pools, loading, error } = usePools(chains, "trending", "1h", 45_000);
  const now = useNow(30_000);
  const top = useMemo(() => pools.filter((p) => (p.reserveUsd ?? 0) >= 5_000).slice(0, 5), [pools]);
  return (
    <div className={clsx("panel overflow-hidden bg-gradient-to-b to-transparent shrink-0 w-[86%] snap-start md:w-auto", accent)} data-testid="trending-column">
      <div className="px-4 pt-4 pb-2 flex items-center gap-2">
        <ChainIcon chain={icon} size={20} />
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold leading-tight flex items-center gap-1.5">{title}<Flame size={14} className="text-warn" /></h2>
          {sub && <div className="text-[11.5px] text-muted">{sub}</div>}
        </div>
      </div>
      <ol className="px-2 pb-2">
        {loading && !top.length && Array.from({ length: 5 }).map((_, i) => <li key={i} className="px-2 py-2"><Skeleton className="h-9 w-full" /></li>)}
        {!loading && !top.length && <li className="px-3 py-6 text-center text-[13px] text-muted">{error ? "Trending data unavailable — retrying." : "Nothing trending right now."}</li>}
        {top.map((p, i) => (
          <li key={p.id}>
            <Link href={`/token/${p.network}/${p.base.address}`} className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-surface-2/70">
              <span className="w-4 text-[12px] text-faint num text-right">{i + 1}</span>
              <TokenIcon src={p.base.image} symbol={p.base.symbol} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold truncate">{p.base.symbol}</span>
                <span className="block text-[11.5px] text-muted truncate">Liq {formatUsd(p.reserveUsd, 1)}{p.createdAt ? ` · ${age(p.createdAt, now)}` : ""}</span>
              </span>
              <span className="text-right">
                <span className="block text-[13.5px] num">{formatPrice(p.priceUsd)}</span>
                <Pct v={p.change.h1} className="text-[12px]" />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function NewLaunches({ chains }: { chains: readonly string[] }) {
  const s = usePools(chains, "new", "1h", 20_000);
  return (
    <>
      <Notice tone="warn" className="mx-4 sm:mx-5 mb-3">New tokens are extremely high-risk. Many are abandoned or malicious within hours. Check liquidity, holders and contract permissions before trading.</Notice>
      <PoolTable pools={s.pools} loading={s.loading} error={s.error} emptyText="No new pools yet." />
    </>
  );
}

function BestPerforming({ chains }: { chains: readonly string[] }) {
  const s = usePools(chains, "trending", "24h");
  const pools = useMemo(() => s.pools.filter((p) => (p.reserveUsd ?? 0) >= MIN_LIQ && p.change.h24 !== null).sort((a, b) => (b.change.h24 ?? 0) - (a.change.h24 ?? 0)), [s.pools]);
  return (
    <>
      <p className="px-4 sm:px-5 pb-3 text-[12.5px] text-muted">Trending pools ranked by 24h price change. Only pools with at least {formatUsd(MIN_LIQ, 0)} liquidity.</p>
      <PoolTable pools={pools} loading={s.loading} error={s.error} emptyText="No pools meet the liquidity bar right now." />
    </>
  );
}

function LiquidityPools({ chains }: { chains: readonly string[] }) {
  const s = usePools(chains, "top", "24h");
  const pools = useMemo(() => [...s.pools].sort((a, b) => (b.reserveUsd ?? 0) - (a.reserveUsd ?? 0)), [s.pools]);
  return (
    <>
      <p className="px-4 sm:px-5 pb-3 text-[12.5px] text-muted">The deepest pools by liquidity — where large trades move the price least.</p>
      <PoolTable pools={pools} loading={s.loading} error={s.error} />
    </>
  );
}

interface Launch { mint: string; chain?: string; name: string; symbol: string; fixed_supply: boolean; freeze_revoked: boolean; created_at: string }

function BajarLaunches() {
  const [launches, setLaunches] = useState<Launch[] | null>(null);
  useEffect(() => { fetch("/api/launch/record").then((r) => r.json()).then((b) => setLaunches(b.launches ?? [])).catch(() => setLaunches([])); }, []);
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><Sparkles size={16} className="text-ai" />Launched on Bajar</span>} sub="Tokens created from users' own wallets on Solana, Ethereum, Base and BNB Chain, verified on-chain" action={<Link href="/launchpad" className="text-[13px] text-brand font-medium">Launchpad</Link>} />
      {launches === null ? <div className="px-5 pb-5"><Skeleton className="h-14 w-full" /></div> : launches.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">No launches yet. <Link href="/launchpad#create" className="text-brand">Launch the first one.</Link></p>
      ) : (
        <ul className="flex gap-2 overflow-x-auto no-scrollbar px-4 sm:px-5 pb-5">
          {launches.slice(0, 12).map((l) => (
            <li key={l.mint} className="shrink-0">
              <Link href={`/token/${l.chain ?? "solana"}/${l.mint}`} className="flex items-center gap-2.5 rounded-2xl bg-surface-2 hover:bg-surface-3 px-3 py-2.5 min-w-[200px]">
                <TokenIcon symbol={l.symbol} size={28} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold truncate">{l.symbol}</span>
                  <span className="block text-[11.5px] text-muted">{timeAgo(new Date(l.created_at).getTime())}</span>
                </span>
                {l.fixed_supply && <Badge tone="up" className="ml-auto">Fixed</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

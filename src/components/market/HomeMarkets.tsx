"use client";
import { useState } from "react";
import Link from "next/link";
import { usePoll } from "@/hooks/usePoll";
import { useWatchlist } from "@/hooks/useWatchlist";
import { getChain } from "@/lib/chains";
import type { CoinMarket, Envelope, Pool } from "@/lib/types";
import { Card, Tabs, Notice } from "../ui/primitives";
import { DataStatus } from "../ui/DataStatus";
import { NetworkFilter } from "./NetworkFilter";
import { CoinTable } from "./CoinTable";
import { PoolTable } from "./PoolTable";
import { LaunchpadCard, MarketNews, NewlyLaunched, TrendingTokens } from "./SideFeeds";

type Tab = "overview" | "trending" | "gainers" | "losers" | "new" | "volume" | "watchlist";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Market Overview" }, { id: "trending", label: "Trending" }, { id: "gainers", label: "Top Gainers" },
  { id: "losers", label: "Top Losers" }, { id: "new", label: "New Tokens" }, { id: "volume", label: "High Volume" }, { id: "watchlist", label: "Watchlist" },
];

export function HomeMarkets({ initialCoins }: { initialCoins: Envelope<CoinMarket[]> | null }) {
  const [network, setNetwork] = useState("all");
  const [tab, setTab] = useState<Tab>("overview");
  const chain = getChain(network);
  // All networks → listed coins (CoinLore + Binance). A specific chain → its on-chain pools.
  const coins = usePoll<CoinMarket[]>(!chain ? "/api/market/coins" : null, 30_000, initialCoins ?? undefined);
  const poolFeed = tab === "new" ? "new" : tab === "trending" ? "trending" : chain && tab !== "watchlist" ? "top" : null;
  const pools = usePoll<Pool[]>(poolFeed ? `/api/dex/pools?feed=${poolFeed}&duration=1h${chain ? `&network=${chain.id}` : ""}` : null, poolFeed === "new" ? 20_000 : 45_000);
  const watch = useWatchlist();
  const watchedCoinIds = watch.items.filter((i) => i.kind === "coin").map((i) => i.id);
  const watchCoins = usePoll<CoinMarket[]>(tab === "watchlist" && watchedCoinIds.length ? `/api/market/coins?ids=${watchedCoinIds.join(",")}` : null, 30_000);

  const list = coins.data ?? [];
  const poolList = pools.data ?? [];
  const coinStatus = <DataStatus fetchedAt={coins.fetchedAt} expectedMs={30_000} stale={coins.stale} error={coins.error} source={coins.source ?? "CoinLore + Binance"} />;
  const poolStatus = <DataStatus fetchedAt={pools.fetchedAt} expectedMs={45_000} stale={pools.stale} error={pools.error} source="GeckoTerminal (on-chain)" />;
  const sortedPools = (key: "change" | "volume", dir: 1 | -1) =>
    [...poolList].sort((a, b) => dir * ((key === "change" ? (a.change.h24 ?? 0) - (b.change.h24 ?? 0) : (a.volume.h24 ?? 0) - (b.volume.h24 ?? 0))));
  let body: React.ReactNode;
  let status = chain ? poolStatus : coinStatus;
  if (tab === "watchlist") {
    const tokenItems = watch.items.filter((i) => i.kind === "token");
    status = <span className="text-[11px] text-muted">Stored on this device</span>;
    body = !watch.items.length ? (
      <div className="p-10 text-center text-sm text-muted">Your watchlist is empty. Tap the ☆ next to any token to add it.</div>
    ) : (
      <>
        {watchedCoinIds.length > 0 && <CoinTable coins={watchCoins.data ?? []} loading={watchCoins.loading} error={watchCoins.error} />}
        {tokenItems.length > 0 && (
          <div className="border-t border-line p-3 flex flex-wrap gap-2">
            <span className="text-xs text-muted w-full">On-chain tokens</span>
            {tokenItems.map((t) => t.kind === "token" && (
              <Link key={t.address} href={`/token/${t.chain}/${t.address}`} className="text-xs rounded-lg border border-line px-2.5 py-1.5 hover:bg-surface-2">{t.label} <span className="text-muted">· {getChain(t.chain)?.name}</span></Link>
            ))}
          </div>
        )}
      </>
    );
  } else if (tab === "trending" || tab === "new") {
    status = poolStatus;
    body = <PoolTable pools={poolList} loading={pools.loading} error={pools.error} emptyText={tab === "new" ? "No new pools right now." : undefined} />;
  } else if (chain) {
    const rows = tab === "gainers" ? sortedPools("change", -1).slice(0, 25) : tab === "losers" ? sortedPools("change", 1).slice(0, 25) : tab === "volume" ? sortedPools("volume", -1) : poolList;
    body = <PoolTable pools={rows} loading={pools.loading} error={pools.error} />;
  } else {
    const rows = tab === "gainers" ? [...list].filter((c) => c.change24h !== null).sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0)).slice(0, 25)
      : tab === "losers" ? [...list].filter((c) => c.change24h !== null).sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0)).slice(0, 25)
      : tab === "volume" ? [...list].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, 25)
      : list;
    body = <CoinTable coins={rows} loading={coins.loading} error={coins.error} limit={100} />;
  }

  return (
    <div className="space-y-4">
      <NetworkFilter value={network} onChange={setNetwork} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px_330px] lg:grid-cols-[minmax(0,1fr)_330px]">
        <Card className="min-w-0 self-start">
          <div className="flex items-center justify-between gap-3 border-b border-line px-2 sm:px-3">
            <Tabs tabs={TABS} value={tab} onChange={setTab} className="min-w-0" />
            <div className="hidden md:block shrink-0 pr-2">{status}</div>
          </div>
          <div className="md:hidden px-4 pt-2">{status}</div>
          {chain && (tab === "overview" || tab === "gainers" || tab === "losers" || tab === "volume") && (
            <div className="px-4 pt-3"><Notice>Live on-chain pools on {chain.name}, ranked by 24h volume. More filters in <Link className="text-brand" href={`/discover?network=${chain.id}`}>Discover</Link>.</Notice></div>
          )}
          {!chain && (tab === "gainers" || tab === "losers" || tab === "volume") && <div className="px-4 pt-2 text-[11px] text-faint">Ranked within the top 100 by market cap.</div>}
          {body}
        </Card>
        <div className="space-y-4 min-w-0">
          <TrendingTokens network={network} />
          <NewlyLaunched network={network} />
        </div>
        <div className="space-y-4 min-w-0 lg:col-span-2 xl:col-span-1 grid lg:grid-cols-2 xl:grid-cols-1 gap-4 lg:space-y-0 xl:space-y-4 xl:block">
          <MarketNews />
          <LaunchpadCard />
        </div>
      </div>
    </div>
  );
}


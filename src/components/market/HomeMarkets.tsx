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
import type { TrendingCoin } from "@/lib/market/coingecko";

type Tab = "overview" | "trending" | "gainers" | "losers" | "new" | "volume" | "watchlist";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Market Overview" }, { id: "trending", label: "Trending" }, { id: "gainers", label: "Top Gainers" },
  { id: "losers", label: "Top Losers" }, { id: "new", label: "New Tokens" }, { id: "volume", label: "High Volume" }, { id: "watchlist", label: "Watchlist" },
];

export function HomeMarkets({ initialCoins }: { initialCoins: Envelope<CoinMarket[]> | null }) {
  const [network, setNetwork] = useState("all");
  const [tab, setTab] = useState<Tab>("overview");
  const chain = getChain(network);
  const coinsUrl = `/api/market/coins${chain ? `?network=${chain.id}` : ""}`;
  const coins = usePoll<CoinMarket[]>(coinsUrl, 60_000, network === "all" ? initialCoins ?? undefined : undefined);
  const needPools = tab === "new" || (tab === "trending" && chain);
  const pools = usePoll<Pool[]>(needPools ? `/api/dex/pools?feed=${tab === "new" ? "new" : "trending"}${chain ? `&network=${chain.id}` : ""}` : null, 30_000);
  const trendingCoins = usePoll<TrendingCoin[]>(tab === "trending" && !chain ? "/api/market/trending" : null, 300_000);
  const watch = useWatchlist();
  const watchedCoinIds = watch.items.filter((i) => i.kind === "coin").map((i) => i.id);
  const watchCoins = usePoll<CoinMarket[]>(tab === "watchlist" && watchedCoinIds.length ? `/api/market/coins?ids=${watchedCoinIds.join(",")}` : null, 60_000);

  const list = coins.data ?? [];
  let body: React.ReactNode;
  let status = <DataStatus fetchedAt={coins.fetchedAt} expectedMs={60_000} stale={coins.stale} error={coins.error} source="CoinGecko · live prices via Binance" />;
  switch (tab) {
    case "overview":
      body = <CoinTable coins={list} loading={coins.loading} error={coins.error} limit={100} />;
      break;
    case "gainers":
      body = <CoinTable coins={[...list].filter((c) => c.change24h !== null).sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0)).slice(0, 25)} loading={coins.loading} error={coins.error} />;
      break;
    case "losers":
      body = <CoinTable coins={[...list].filter((c) => c.change24h !== null).sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0)).slice(0, 25)} loading={coins.loading} error={coins.error} />;
      break;
    case "volume":
      body = <CoinTable coins={[...list].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, 25)} loading={coins.loading} error={coins.error} />;
      break;
    case "trending":
      if (chain) {
        body = <PoolTable pools={pools.data ?? []} loading={pools.loading} error={pools.error} />;
        status = <DataStatus fetchedAt={pools.fetchedAt} expectedMs={30_000} stale={pools.stale} error={pools.error} source="GeckoTerminal" />;
      } else {
        const ids = new Set((trendingCoins.data ?? []).map((t) => t.id));
        const fromList = list.filter((c) => ids.has(c.id));
        body = trendingCoins.data ? <TrendingList items={trendingCoins.data} /> : <CoinTable coins={fromList} loading />;
        status = <DataStatus fetchedAt={trendingCoins.fetchedAt} expectedMs={300_000} stale={trendingCoins.stale} error={trendingCoins.error} source="CoinGecko trending searches" />;
      }
      break;
    case "new":
      body = <PoolTable pools={pools.data ?? []} loading={pools.loading} error={pools.error} emptyText="No new pools right now." />;
      status = <DataStatus fetchedAt={pools.fetchedAt} expectedMs={30_000} stale={pools.stale} error={pools.error} source="GeckoTerminal" />;
      break;
    case "watchlist": {
      const tokenItems = watch.items.filter((i) => i.kind === "token");
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
      status = <span className="text-[11px] text-muted">Stored on this device</span>;
      break;
    }
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
            <div className="px-4 pt-3"><Notice>Showing listed coins in the {chain.name} ecosystem (CoinGecko category). For on-chain pools see Trending, New Tokens or <Link className="text-brand" href={`/discover?network=${chain.id}`}>Discover</Link>.</Notice></div>
          )}
          {(tab === "gainers" || tab === "losers" || tab === "volume") && <div className="px-4 pt-2 text-[11px] text-faint">Ranked within the top 100 by market cap.</div>}
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

function TrendingList({ items }: { items: TrendingCoin[] }) {
  return (
    <ul className="divide-y divide-line/60">
      {items.map((t, i) => (
        <li key={t.id}>
          <Link href={`/coin/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/70 text-sm">
            <span className="w-5 text-muted num">{i + 1}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.thumb ? <img src={t.thumb} alt="" className="h-7 w-7 rounded-full" /> : null}
            <span className="font-semibold">{t.name}</span><span className="text-xs text-muted">{t.symbol}</span>
            <span className="flex-1" />
            {t.rank && <span className="text-xs text-muted hidden sm:inline">Rank #{t.rank}</span>}
            <span className="num w-28 text-right">{t.price !== null ? `$${t.price < 1 ? t.price.toPrecision(4) : t.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}</span>
            <span className={`num w-20 text-right ${(t.change24h ?? 0) >= 0 ? "text-up" : "text-down"}`}>{t.change24h !== null ? `${t.change24h > 0 ? "+" : ""}${t.change24h.toFixed(2)}%` : "—"}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

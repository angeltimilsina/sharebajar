"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ChevronDown, Sparkles } from "lucide-react";
import { usePoll } from "@/hooks/usePoll";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useLiveTickers } from "@/hooks/useBinance";
import { useBinanceSymbols } from "@/hooks/useBinanceSymbols";
import { getChain } from "@/lib/chains";
import { formatPct, formatUsd } from "@/lib/format";
import type { CoinMarket, Envelope, Pool } from "@/lib/types";
import {
  COIN_STATS, POOL_STATS, STAT_LABEL, applyLens, coinRow, isChange, isSmart, lensSource, poolRow, ribbon, statFor,
  type BoardRow, type Lens, type Stat,
} from "@/lib/market/board";
import { Card, Skeleton } from "../ui/primitives";
import { DataStatus } from "../ui/DataStatus";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainIcon } from "../ui/ChainIcon";
import { Sparkline } from "../ui/Sparkline";
import { NetworkFilter } from "./NetworkFilter";
import { PriceCell } from "./PriceCell";
import { WatchStar } from "./WatchStar";
import { MarketNews, TrendingTokens } from "./SideFeeds";

const PREF = "bajar.board.v1";
type Prefs = { lens: Lens; stat: Stat; network: string };
const DEFAULTS: Prefs = { lens: "top", stat: "change24h", network: "all" };
const loadPrefs = (): Prefs => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREF) ?? "{}") }; } catch { return DEFAULTS; } };

const TONE = { up: "text-up bg-up/10", down: "text-down bg-down/10", warn: "text-warn bg-warn/10", info: "text-muted bg-surface-2" };

function statText(s: Stat, v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return isChange(s) ? formatPct(v) : formatUsd(v);
}

export function MarketBoard({ initialCoins }: { initialCoins: Envelope<CoinMarket[]> | null }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  useEffect(() => setPrefs(loadPrefs()), []);
  const set = (p: Partial<Prefs>) => setPrefs((cur) => {
    const next = { ...cur, ...p };
    try { localStorage.setItem(PREF, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const { lens, network } = prefs;
  const chain = getChain(network);
  const source = lensSource(lens, network);

  // Listed coins power both the "all networks" list and the ribbon's suggestions.
  const coins = usePoll<CoinMarket[]>(source.kind === "coins" || network === "all" ? "/api/market/coins" : null, 30_000, initialCoins ?? undefined);
  const pools = usePoll<Pool[]>(source.kind === "pools" ? `/api/dex/pools?feed=${source.feed}&duration=1h${chain ? `&network=${chain.id}` : ""}` : null, source.kind === "pools" && source.feed === "new" ? 20_000 : 45_000);
  const watch = useWatchlist();
  const watchedIds = watch.items.filter((i) => i.kind === "coin").map((i) => i.id);
  const watchCoins = usePoll<CoinMarket[]>(source.kind === "watchlist" && watchedIds.length ? `/api/market/coins?ids=${watchedIds.join(",")}` : null, 30_000);
  const symbols = useBinanceSymbols();

  const baseRows: BoardRow[] = useMemo(() => {
    if (source.kind === "coins") return (coins.data ?? []).map((c) => coinRow(c, symbols[c.symbol]));
    if (source.kind === "pools") return (pools.data ?? []).map((p) => poolRow(p));
    const coinRows = (watchCoins.data ?? []).map((c) => coinRow(c, symbols[c.symbol]));
    const tokenRows: BoardRow[] = watch.items.flatMap((i) => i.kind === "token" ? [{
      key: `w:${i.chain}:${i.address}`, kind: "pool" as const, href: `/token/${i.chain}/${i.address}`, symbol: i.label, name: getChain(i.chain)?.name ?? i.chain,
      image: null, rank: null, network: i.chain, pair: null, price: null, stats: {}, spark: [], signals: [], watch: { kind: "token" as const, id: i.address, chain: i.chain, address: i.address, label: i.label },
    }] : []);
    return [...coinRows, ...tokenRows];
  }, [source.kind, coins.data, pools.data, watchCoins.data, watch.items, symbols]);

  const stat = statFor(baseRows.length ? baseRows : source.kind === "pools" ? [poolRowStub] : [], prefs.stat);
  const rows = useMemo(() => applyLens(baseRows, lens, stat), [baseRows, lens, stat]);

  // The ribbon: core views with live previews, plus suggestions for what's happening now.
  const coinRows = useMemo(() => (coins.data ?? []).map((c) => coinRow(c, symbols[c.symbol])), [coins.data, symbols]);
  const items = useMemo(() => ribbon(coinRows, stat, { coins: network === "all" }), [coinRows, stat, network]);
  // A remembered suggestion that no longer applies (or a network was picked) falls back to Top.
  useEffect(() => {
    if (!isSmart(lens)) return;
    if (network !== "all" || (coins.data && !items.some((i) => i.id === lens))) set({ lens: "top" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens, network, coins.data, items]);
  const statOptions = source.kind === "pools" ? POOL_STATS : COIN_STATS;

  // Live Binance overlay for the visible coins (agreement-checked like the rest of the site).
  const live = useLiveTickers(rows.slice(0, 40).flatMap((r) => (r.liveSymbol ? [r.liveSymbol] : [])));
  const withLive = (r: BoardRow): BoardRow => {
    const l = r.liveSymbol ? live[r.liveSymbol] : undefined;
    if (!l || !r.price || Math.abs(l.price - r.price) / r.price >= 0.03) return r;
    return { ...r, price: l.price, stats: { ...r.stats, change24h: l.change24h } };
  };

  const env = source.kind === "coins" ? coins : source.kind === "pools" ? pools : watchCoins;
  const loading = source.kind === "watchlist" ? watchCoins.loading && !!watchedIds.length : env.loading && !env.data;
  const cycleStat = () => set({ stat: statOptions[(statOptions.indexOf(stat) + 1) % statOptions.length] });
  const lensInfo = items.find((l) => l.id === lens) ?? { id: lens, label: "Top", hint: "" };
  const timeframe = isChange(stat) ? STAT_LABEL[stat] : "24h";

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 space-y-3" aria-label="Market list">
        {/* Lenses */}
        <div role="tablist" aria-label="Market view" className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3 sm:mx-0 sm:px-0" data-testid="board-lenses">
          {items.map((l) => {
            const on = lens === l.id;
            return (
              <button key={l.id} role="tab" aria-selected={on} title={l.hint} onClick={() => set({ lens: l.id })} data-testid={`lens-${l.id.replace(":", "-")}`}
                className={clsx("h-9 shrink-0 pl-3.5 pr-3.5 rounded-full text-[14px] font-medium transition-colors inline-flex items-center gap-1.5", on ? "btn-ink" : "bg-surface-2 text-fg/85 hover:text-fg")}>
                {l.smart && <Sparkles size={13} className={on ? "" : "text-brand"} aria-hidden />}
                {l.label}
                {l.preview && (
                  <span className={clsx("text-[12px] num font-semibold", on ? "opacity-85" : l.preview.tone === "up" ? "text-up" : l.preview.tone === "down" ? "text-down" : "text-muted")}>{l.preview.text}</span>
                )}
                {l.smart && l.count !== undefined && <span className={clsx("text-[11px] num rounded-full px-1.5 min-w-[20px] text-center", on ? "bg-white/20" : "bg-surface-3 text-muted")}>{l.count}</span>}
              </button>
            );
          })}
        </div>
        <NetworkFilter value={network} onChange={(n) => set({ network: n })} />

        <Card className="overflow-hidden" data-testid="market-board">
          {/* Caption + stat switch */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3.5 pb-3 border-b border-line">
            <div className="min-w-0 w-full sm:w-auto sm:flex-1">
              <div className="text-[15px] font-semibold" data-testid="board-caption">
                {lens === "gainers" || lens === "losers" ? `${lensInfo.label} · ${timeframe}` : lensInfo.label}
                <span className="text-muted font-normal"> · {chain ? chain.name : lens === "trending" || lens === "new" ? "all networks" : source.kind === "watchlist" ? "your list" : isSmart(lens) ? `${rows.length} coin${rows.length === 1 ? "" : "s"}` : "all coins"}</span>
              </div>
              <div className="mt-0.5"><DataStatus fetchedAt={env.fetchedAt} expectedMs={30_000} stale={env.stale} error={env.error} source={env.source ?? undefined} /></div>
            </div>
            <div role="radiogroup" aria-label="Stat" className="flex w-full sm:w-auto rounded-full bg-surface-2 p-0.5 overflow-x-auto no-scrollbar" data-testid="board-stats">
              {statOptions.map((s) => (
                <button key={s} role="radio" aria-checked={stat === s} onClick={() => set({ stat: s })}
                  className={clsx("h-8 sm:h-7 flex-1 sm:flex-none px-3 rounded-full text-[12.5px] font-medium whitespace-nowrap", stat === s ? "seg-on text-fg" : "text-muted hover:text-fg")}>
                  {STAT_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Desktop column header */}
          <div className="hidden lg:grid board-grid px-4 py-2 text-[11.5px] text-muted border-b border-line">
            <span /><span>#</span><span>Asset</span><span className="text-right">Price</span>
            {statOptions.map((s) => (
              <button key={s} onClick={() => set({ stat: s })} className={clsx("text-right inline-flex justify-end items-center gap-0.5 hover:text-fg", stat === s && "text-fg font-semibold")}>
                {STAT_LABEL[s]}{stat === s && <ChevronDown size={11} />}
              </button>
            ))}
            <span className="hidden 2xl:block text-right">{source.kind === "pools" ? "" : "7 days"}</span>
          </div>

          {loading && <div className="p-4 space-y-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>}
          {!loading && env.error && !rows.length && <div className="p-10 text-center text-sm"><div className="text-down">Market data unavailable</div><div className="text-xs text-muted mt-1">{env.error} — retrying automatically.</div></div>}
          {!loading && !env.error && !rows.length && (
            <div className="p-10 text-center text-sm text-muted">{source.kind === "watchlist" ? "Your watchlist is empty. Tap ☆ on any asset to save it." : "Nothing matches right now."}</div>
          )}
          <ul>
            {rows.slice(0, 100).map((r0, i) => {
              const r = withLive(r0);
              return (
                <li key={r.key} className="border-b border-line/60 last:border-0">
                  <div className="relative grid board-grid items-center gap-x-3 px-4 py-3 hover:bg-surface-2/60">
                    <span className="hidden lg:block relative z-10"><WatchStar item={r.watch} /></span>
                    <span className="hidden lg:block text-muted text-[12.5px] num">{r.rank ?? i + 1}</span>
                    <Link href={r.href} className="flex items-center gap-3 min-w-0 after:absolute after:inset-0" data-testid="board-row">
                      <span className="relative shrink-0">
                        <TokenIcon src={r.image} symbol={r.symbol} size={34} canonical={r.kind === "coin"} />
                        {r.network && <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[1.5px]"><ChainIcon chain={r.network} size={13} /></span>}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-semibold text-[14.5px] truncate">{r.kind === "coin" ? r.name : r.symbol}</span>
                          <span className="text-muted text-[12px] shrink-0">{r.kind === "coin" ? r.symbol : r.pair ?? r.name}</span>
                        </span>
                        {r.signals.length > 0 && (
                          <span className="mt-1 flex gap-1 overflow-hidden">
                            {r.signals.map((s) => <span key={s.label} title={s.detail} className={clsx("text-[10.5px] font-medium rounded-full px-1.5 py-0.5 whitespace-nowrap", TONE[s.tone])}>{s.label}</span>)}
                          </span>
                        )}
                      </span>
                    </Link>
                    {/* Phone: price + the selected stat (tap it to switch stat). */}
                    <div className="lg:hidden flex items-center gap-2.5 justify-end">
                      <span className="text-right text-[14px]"><PriceCell value={r.price} live={!!r.liveSymbol} /></span>
                      <button onClick={cycleStat} aria-label={`Showing ${STAT_LABEL[stat]}. Tap to switch stat.`} data-testid="board-stat-pill"
                        className={clsx("relative z-10 min-w-[74px] h-8 px-2 rounded-lg text-[13px] font-semibold num text-right",
                          isChange(stat) ? ((r.stats[stat] ?? 0) >= 0 ? "bg-up/12 text-up" : "bg-down/12 text-down") : "bg-surface-2 text-fg")}>
                        {statText(stat, r.stats[stat])}
                      </button>
                    </div>
                    {/* Desktop: every stat as a column, selected one emphasised. */}
                    <span className="hidden lg:block text-right text-[14px]"><PriceCell value={r.price} live={!!r.liveSymbol} /></span>
                    {statOptions.map((s) => (
                      <span key={s} className={clsx("hidden lg:block text-right num text-[13.5px]", isChange(s) && r.stats[s] !== null && r.stats[s] !== undefined ? ((r.stats[s] ?? 0) >= 0 ? "text-up" : "text-down") : "", stat === s ? "font-semibold" : "opacity-80")}>
                        {statText(s, r.stats[s])}
                      </span>
                    ))}
                    <span className="hidden 2xl:flex justify-end">{r.spark.length > 1 && <Sparkline data={r.spark} width={88} height={28} />}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          {isSmart(lens) && lensInfo.hint && <p className="px-4 py-2.5 text-[11px] text-faint border-t border-line">Suggested from live data: {lensInfo.hint.charAt(0).toLowerCase() + lensInfo.hint.slice(1)}.</p>}
          {(lens === "gainers" || lens === "losers") && source.kind === "coins" && <p className="px-4 py-2.5 text-[11px] text-faint border-t border-line">Coins with at least $1M daily volume, ranked by {timeframe} change.</p>}
        </Card>
      </section>

      <aside className="hidden xl:block space-y-4 min-w-0">
        <TrendingTokens network={network} />
        <MarketNews limit={5} />
      </aside>
    </div>
  );
}

// Lets statFor pick pool stats before pool data has arrived.
const poolRowStub = { kind: "pool" } as BoardRow;

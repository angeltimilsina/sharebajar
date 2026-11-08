"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowDownLeft, ArrowUpRight, Repeat, RefreshCw, Eye, EyeOff, ChevronRight, AlertTriangle, Info, TrendingUp, TrendingDown } from "lucide-react";
import clsx from "clsx";
import { Badge, Card, Notice, Skeleton } from "../ui/primitives";
import { DataStatus } from "../ui/DataStatus";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainIcon } from "../ui/ChainIcon";
import { formatNumber, formatPct, formatUsd, pctClass } from "@/lib/format";
import { settings } from "@/lib/bajar/session";
import { allocation, assetHref, dayChange, walletInsights, type WalletInsight } from "@/lib/bajar/insights";
import { usePortfolio, type Holding } from "./PortfolioPanel";
import type { WalletView } from "./WalletApp";

const ActivityPanel = dynamic(() => import("./ActivityPanel").then((m) => m.ActivityPanel), { loading: () => <Skeleton className="h-40 w-full" /> });

const SLICE_COLORS = ["#d97757", "#6a9bcc", "#788c5d", "#c2a25b", "#a686c4", "#8b887f"];
const HIDE_KEY = "bajar.hideBalances";
const SMALL_KEY = "bajar.showSmall";
const readFlag = (k: string) => { try { return localStorage.getItem(k) === "1"; } catch { return false; } };
const writeFlag = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* private mode */ } };

export function WalletDashboard({ go }: { go: (v: WalletView) => void }) {
  const p = usePortfolio();
  const [hidden, setHidden] = useState(() => readFlag(HIDE_KEY));
  const [showSmall, setShowSmall] = useState(() => readFlag(SMALL_KEY));
  const holdings = useMemo(() => (p.data?.holdings ?? []).filter((h) => h.amount > 0), [p.data]);
  const day = useMemo(() => dayChange(holdings), [holdings]);
  const insights = useMemo(() => walletInsights(holdings, { backedUp: !!settings().backedUpAt, loaded: !!p.data }), [holdings, p.data]);
  const mask = (s: string) => (hidden ? "••••" : s);

  // One DOM, two layouts: phones stack everything in priority order (flex + order);
  // desktop splits into a main column and a side column (the wrappers become blocks).
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className="contents lg:block lg:space-y-4 min-w-0">
        {/* Balance + actions */}
        <Card className="p-5 order-1">
          <div className="flex items-center gap-2 text-xs text-muted">
            Total balance
            <button onClick={() => { setHidden(!hidden); writeFlag(HIDE_KEY, !hidden); }} aria-label={hidden ? "Show balances" : "Hide balances"} className="text-muted hover:text-fg">{hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
          </div>
          <div className="mt-1 text-[34px] leading-tight font-semibold num" data-testid="bajar-total">
            {p.data ? mask(formatUsd(p.data.totalUsd)) : <Skeleton className="h-10 w-44" />}
          </div>
          {p.data && holdings.length > 0 && day.pct !== null && (
            <div className={clsx("text-sm num mt-0.5", pctClass(day.usd))} data-testid="bajar-day-change">
              {mask(`${day.usd >= 0 ? "+" : "−"}${formatUsd(Math.abs(day.usd))}`)} ({formatPct(day.pct)}) <span className="text-muted">today</span>
              {day.coverage < 0.95 && <span className="text-faint text-xs" title="Some holdings have no 24h price history"> · {Math.round(day.coverage * 100)}% of holdings</span>}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2">
            <DataStatus expectedMs={20_000} fetchedAt={p.fetchedAt} source={p.source} stale={p.stale} error={p.error} />
            <button onClick={p.refresh} className="text-muted hover:text-fg" aria-label="Refresh balances"><RefreshCw size={13} /></button>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 sm:max-w-sm">
            <ActionButton icon={<ArrowUpRight size={19} />} label="Send" onClick={() => go("send")} testid="wallet-action-send" />
            <ActionButton icon={<ArrowDownLeft size={19} />} label="Receive" onClick={() => go("receive")} testid="wallet-action-receive" />
            <ActionButton icon={<Repeat size={18} />} label="Swap" onClick={() => go("swap")} testid="wallet-action-swap" />
          </div>
        </Card>

        {p.data?.errors.length ? <Notice tone="warn" className="order-3" title="Some networks didn't respond">{p.data.errors.join(" · ")}. Balances on those networks may be missing.</Notice> : null}

        <div className="order-4"><HoldingsList holdings={holdings} loaded={!!p.data} hidden={hidden} showSmall={showSmall} onToggleSmall={() => { setShowSmall(!showSmall); writeFlag(SMALL_KEY, !showSmall); }} onReceive={() => go("receive")} /></div>
      </div>

      <div className="contents lg:block lg:space-y-4 min-w-0">
        <div className="order-2 min-w-0"><Insights items={insights} go={go} /></div>
        <div className="order-5"><Allocation holdings={holdings} hidden={hidden} /></div>
        <div className="order-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-sans font-semibold text-muted">Recent activity</h2>
            <button className="text-xs text-muted hover:text-fg inline-flex items-center" onClick={() => go("activity")}>See all<ChevronRight size={13} /></button>
          </div>
          <ActivityPanel limit={4} compact />
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon, label, onClick, testid }: { icon: React.ReactNode; label: string; onClick: () => void; testid: string }) {
  return (
    <button onClick={onClick} data-testid={testid} className="group flex flex-col items-center gap-1.5 rounded-2xl py-2.5 hover:bg-surface-2 active:scale-[0.98] transition">
      <span className="h-11 w-11 rounded-full grid place-items-center btn-ink">{icon}</span>
      <span className="text-[13px] font-medium">{label}</span>
    </button>
  );
}

const TONE_ICON = { warn: AlertTriangle, info: Info, up: TrendingUp, down: TrendingDown };
const TONE_CLASS = { warn: "text-warn", info: "text-muted", up: "text-up", down: "text-down" };

function Insights({ items, go }: { items: WalletInsight[]; go: (v: WalletView) => void }) {
  if (!items.length) return null;
  return (
    <section aria-label="Insights" data-testid="wallet-insights">
      {/* Phone: swipeable row. Desktop: stacked list. */}
      <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x -mx-3 px-3 sm:mx-0 sm:px-0 lg:flex-col">
        {items.slice(0, 4).map((i) => {
          const Icon = TONE_ICON[i.tone];
          return (
            <Card key={i.id} className="p-4 snap-start shrink-0 w-[82%] sm:w-[320px] lg:w-auto" data-testid={`insight-${i.id.split(":")[0]}`}>
              <div className="flex items-start gap-2.5">
                <Icon size={16} className={clsx("mt-0.5 shrink-0", TONE_CLASS[i.tone])} />
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold leading-snug">{i.title}</div>
                  <p className="text-[12.5px] text-muted mt-1 leading-relaxed">{i.body}</p>
                  {i.action && <button onClick={() => go(i.action!.to)} className="mt-2 text-[13px] font-medium underline underline-offset-2 hover:text-fg">{i.action.label}</button>}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function HoldingsList({ holdings, loaded, hidden, showSmall, onToggleSmall, onReceive }: { holdings: Holding[]; loaded: boolean; hidden: boolean; showSmall: boolean; onToggleSmall: () => void; onReceive: () => void }) {
  const small = holdings.filter((h) => h.usdValue !== null && h.usdValue < 1);
  const shown = showSmall ? holdings : holdings.filter((h) => !(h.usdValue !== null && h.usdValue < 1));
  return (
    <Card data-testid="wallet-holdings">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-base">Assets</h2>
        {small.length > 0 && <button onClick={onToggleSmall} className="text-xs text-muted hover:text-fg">{showSmall ? "Hide" : "Show"} {small.length} small balance{small.length > 1 ? "s" : ""}</button>}
      </div>
      <ul className="divide-y divide-line/70">
        {!loaded && Array.from({ length: 4 }, (_, i) => <li key={i} className="px-4 py-3"><Skeleton className="h-9" /></li>)}
        {loaded && !holdings.length && (
          <li className="px-4 py-8 text-center">
            <p className="text-sm text-muted">No assets yet.</p>
            <button onClick={onReceive} className="mt-2 text-sm font-medium underline underline-offset-2">Receive your first crypto</button>
          </li>
        )}
        {shown.map((h) => {
          const href = assetHref(h);
          const body = (
            <>
              <span className="relative shrink-0">
                <TokenIcon symbol={h.symbol} size={36} canonical={!h.custom} />
                {h.network !== "bitcoin" && <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[1.5px]"><ChainIcon chain={h.network} size={14} /></span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-semibold flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{h.symbol}</span>
                  {h.wrappedBtc && <Badge tone="warn" title="A token on another network that represents BTC via a custodian or bridge. Not native bitcoin.">wrapped</Badge>}
                  {h.custom && <Badge>custom</Badge>}
                </div>
                <div className="text-[12px] text-muted truncate">
                  {h.network === "bitcoin" ? "Bitcoin · native" : h.networkName}
                  {h.usdPrice !== null && <> · {formatUsd(h.usdPrice, h.usdPrice < 1 ? 4 : 2)}</>}
                  {h.change24h !== null && h.change24h !== undefined && <span className={clsx("ml-1 num", pctClass(h.change24h))}>{formatPct(h.change24h)}</span>}
                </div>
              </div>
              <div className="text-right num shrink-0">
                <div className="text-[14.5px] font-medium">{h.usdValue !== null ? (hidden ? "••••" : formatUsd(h.usdValue)) : <span className="text-faint text-xs">not valued</span>}</div>
                <div className="text-[12px] text-muted">{hidden ? "••••" : `${formatNumber(h.amount, h.amount < 1 ? 6 : 4)} ${h.symbol}`}</div>
              </div>
            </>
          );
          return (
            <li key={h.network + h.token}>
              {href
                ? <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60 active:bg-surface-2">{body}</Link>
                : <div className="flex items-center gap-3 px-4 py-3">{body}</div>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Allocation({ holdings, hidden }: { holdings: Holding[]; hidden: boolean }) {
  const [by, setBy] = useState<"asset" | "network">("asset");
  const slices = useMemo(() => allocation(holdings, by), [holdings, by]);
  if (!slices.length) return null;
  return (
    <Card className="p-4" data-testid="wallet-allocation">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base">Allocation</h2>
        <div className="flex rounded-full bg-surface-2 p-0.5 text-xs">
          {(["asset", "network"] as const).map((k) => (
            <button key={k} onClick={() => setBy(k)} aria-pressed={by === k} className={clsx("px-2.5 py-1 rounded-full capitalize", by === k ? "seg-on text-fg" : "text-muted")}>{k === "asset" ? "Assets" : "Networks"}</button>
          ))}
        </div>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px]" role="img" aria-label={slices.map((s) => `${s.label} ${s.pct.toFixed(0)}%`).join(", ")}>
        {slices.map((s, i) => <div key={s.key} style={{ width: `${Math.max(s.pct, 1.5)}%`, background: SLICE_COLORS[i % SLICE_COLORS.length] }} />)}
      </div>
      <ul className="mt-3 space-y-1.5">
        {slices.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
            <span className="flex-1 truncate">{s.label}</span>
            <span className="num text-muted">{hidden ? "••••" : formatUsd(s.value)}</span>
            <span className="num w-11 text-right font-medium">{s.pct.toFixed(s.pct < 10 ? 1 : 0)}%</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

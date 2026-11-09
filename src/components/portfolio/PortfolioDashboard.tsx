"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Compass, Eye, EyeOff, Link2, RefreshCw, Rocket, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useWalletBalances } from "@/hooks/useWallets";
import { useBinanceSymbols } from "@/hooks/useBinanceSymbols";
import { mergeAssets, useHoldingsHistory, type Asset, type AssetLot, type HistoryPoint, type Range } from "@/hooks/useHoldingsHistory";
import type { TrackedWallet } from "@/lib/wallets/registry";
import { buildAgentPortfolio, stashAgentPortfolio } from "@/lib/wallets/agent";
import { assetHref } from "@/lib/bajar/insights";
import { formatNumber, formatPct, formatPrice, formatUsd, pctClass, timeAgo } from "@/lib/format";
import { Badge, Card, CardHeader, Skeleton } from "../ui/primitives";
import { LogoMark } from "../ui/Logo";
import { ChainIcon } from "../ui/ChainIcon";
import { TokenIcon } from "../ui/TokenIcon";
import { ActivityPanel } from "./ActivityPanel";

const CHAIN_ICON: Record<string, string> = { solana: "solana", evm: "ethereum", bitcoin: "bitcoin" };
const SLICE = ["#0a84ff", "#30d158", "#ff9f0a", "#bf5af2", "#ff375f", "#8e8e93"];
const HIDE_KEY = "bajar.hideBalances"; // shared with Bajar Wallet
const readHidden = () => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } };
const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export interface PortfolioSource { title: string; subtitle: string; manageHref?: string; manageLabel?: string }

/**
 * Portfolio for one wallet: Bajar Wallet (with the wallets connected to it)
 * or the single wallet connected in the browser. One balance card with the
 * chart, then every asset with its details, then research, discovery and
 * the launchpad.
 */
export function PortfolioDashboard({ wallets, source, side }: { wallets: TrackedWallet[]; source: PortfolioSource; side?: ReactNode }) {
  const bal = useWalletBalances(wallets);
  const symbols = useBinanceSymbols();
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setHidden(readHidden()); }, []);
  const [range, setRange] = useState<Range>("7d");

  const assets = useMemo(() => mergeAssets(bal.balances), [bal.balances]);
  const total = assets.reduce((s, a) => s + a.value, 0);
  const hist = useHoldingsHistory(assets, range, symbols);
  const first = hist.points[0]?.v ?? null;
  const change = first && hist.points.length > 1 ? total - first : null;
  const changePct = first && change !== null ? (change / first) * 100 : null;
  const mask = (s: string) => (hidden ? "••••" : s);
  const ask = (q?: string) => { stashAgentPortfolio(buildAgentPortfolio(bal.balances)); router.push(`/intelligence?agent=portfolio${q ? `&q=${encodeURIComponent(q)}` : ""}`); };
  const chains = [...new Set(wallets.map((w) => w.chain))];

  return (
    <div className="space-y-4" data-testid="connected-dashboard">
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="contents lg:block lg:space-y-4 min-w-0">
          <Card className="p-4 sm:p-5 order-1">
            <div className="flex items-center gap-2.5">
              <LogoMark size={30} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[15px] font-semibold truncate" data-testid="portfolio-source">{source.title}</div>
                <div className="text-[12px] text-muted truncate flex items-center gap-1" data-testid="dashboard-wallet-count">{chains.map((c) => <ChainIcon key={c} chain={CHAIN_ICON[c]} size={12} />)}<span className="ml-0.5">{source.subtitle}</span></div>
              </div>
              <button onClick={bal.refresh} disabled={bal.loading} className="h-9 w-9 grid place-items-center rounded-full text-muted hover:text-fg hover:bg-surface-2" aria-label="Refresh balances" title={bal.at ? `Updated ${timeAgo(bal.at)}` : undefined}>
                <RefreshCw size={15} className={bal.loading ? "animate-spin" : ""} />
              </button>
              {source.manageHref && <Link href={source.manageHref} className="h-9 px-3 rounded-full bg-surface-2 hover:bg-surface-3 text-[13px] font-medium inline-flex items-center gap-1.5" data-testid="portfolio-manage"><Link2 size={14} />{source.manageLabel ?? "Manage"}</Link>}
            </div>

            <div className="mt-4 flex items-center gap-2 text-xs text-muted">
              Total balance
              <button onClick={() => { setHidden(!hidden); try { localStorage.setItem(HIDE_KEY, hidden ? "0" : "1"); } catch { /* ignore */ } }} aria-label={hidden ? "Show balances" : "Hide balances"} className="hover:text-fg">{hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            </div>
            <div className="mt-0.5 text-[36px] sm:text-[40px] leading-tight font-semibold num" data-testid="dashboard-total">{bal.at === null && bal.loading ? <Skeleton className="h-11 w-48" /> : mask(formatUsd(total))}</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-0.5">
              {change !== null && changePct !== null
                ? <span className={clsx("text-[14px] num", pctClass(change))}>{mask(`${change >= 0 ? "+" : "−"}${formatUsd(Math.abs(change))}`)} ({formatPct(changePct)}) <span className="text-muted">past {range}</span></span>
                : <span className="text-[14px] text-muted">&nbsp;</span>}
              <div className="flex-1" />
              <div role="radiogroup" aria-label="Chart range" className="flex rounded-full bg-surface-2 p-0.5">
                {(["24h", "7d", "30d"] as Range[]).map((r) => (
                  <button key={r} role="radio" aria-checked={range === r} onClick={() => setRange(r)} className={clsx("h-7 px-3 rounded-full text-[12.5px] font-medium", range === r ? "seg-on text-fg" : "text-muted")}>{r}</button>
                ))}
              </div>
            </div>
            <div className="mt-3"><HoldingsChart points={hist.points} loading={hist.loading || (bal.loading && !bal.at)} up={(change ?? 0) >= 0} range={range} hidden={hidden} /></div>
            <p className="text-[11px] text-faint mt-1.5">Today&apos;s holdings priced over the period (Binance){hist.flat.length ? `; ${hist.flat.slice(0, 3).join(", ")}${hist.flat.length > 3 ? "…" : ""} at today's value` : ""}. Not past balances.</p>
          </Card>

          <div className="order-2"><AssetList assets={assets} total={total} hidden={hidden} loaded={bal.at !== null} /></div>
        </div>

        <div className="contents lg:block lg:space-y-4 min-w-0">
          <div className="order-3"><Allocation assets={assets} total={total} /></div>
          <div className="order-4"><Research assets={assets} onAsk={ask} /></div>
          <div className="order-6 scroll-mt-24" id="activity"><ActivityPanel /></div>
          {side && <div className="order-7">{side}</div>}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Discover />
        <LaunchpadCard addresses={wallets.filter((w) => w.chain !== "bitcoin").map((w) => w.address)} />
      </div>
    </div>
  );
}

/* ── Market research ───────────────────────────────────────────────────── */

function Research({ assets, onAsk }: { assets: Asset[]; onAsk: (q?: string) => void }) {
  const movers = [...assets].filter((a) => a.change24h !== null).sort((a, b) => Math.abs(b.change24h!) - Math.abs(a.change24h!)).slice(0, 3);
  const top = assets[0]?.symbol;
  const prompts = [
    "Review my portfolio: concentration, risk and what to change",
    top ? `What's the outlook for ${top} this week?` : "What's moving the market today?",
    "Which of my holdings look weakest technically?",
  ];
  return (
    <Card className="p-4" data-testid="portfolio-research">
      <div className="flex items-center gap-2"><Sparkles size={16} className="text-ai" /><h2 className="text-base">Market research</h2></div>
      {movers.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {movers.map((a) => (
            <li key={a.key} className="flex items-center gap-2 text-[13px]">
              <TokenIcon src={a.icon} symbol={a.symbol} size={20} canonical />
              <span className="flex-1 font-medium">{a.symbol}</span>
              <span className={clsx("num", pctClass(a.change24h))}>{formatPct(a.change24h)}</span>
              <span className="text-faint text-[11px]">24h</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-col gap-1.5">
        {prompts.map((q) => (
          <button key={q} onClick={() => onAsk(q)} className="text-left rounded-xl bg-surface-2 hover:bg-surface-3 px-3 py-2 text-[13px]">{q}</button>
        ))}
      </div>
      <button onClick={() => onAsk()} className="mt-3 w-full h-10 rounded-xl text-white text-[13.5px] font-semibold inline-flex items-center justify-center gap-1.5" style={{ background: "linear-gradient(135deg,#bf5af2,#0a84ff)" }}><Sparkles size={14} />Open investment agent</button>
    </Card>
  );
}

/* ── Asset discovery ───────────────────────────────────────────────────── */

interface DiscoverPool { id: string; network: string; base: { address: string; symbol: string; image: string | null }; priceUsd: number | null; reserveUsd: number | null; change: { h1: number | null; h24: number | null } }

function Discover() {
  const [pools, setPools] = useState<DiscoverPool[] | null>(null);
  useEffect(() => {
    fetch("/api/dex/pools?feed=trending&duration=1h").then((r) => r.json()).then((b) => setPools(((b.data ?? []) as DiscoverPool[]).filter((p) => (p.reserveUsd ?? 0) >= 10_000).slice(0, 6))).catch(() => setPools([]));
  }, []);
  return (
    <Card data-testid="portfolio-discover">
      <CardHeader title={<span className="inline-flex items-center gap-2"><Compass size={16} className="text-brand" />Discover assets</span>} sub="Trending on Solana, Base and EVM right now" action={<Link href="/tokens" className="text-[13px] text-brand font-medium">Tokens</Link>} />
      <ul className="px-2 pb-2">
        {pools === null && Array.from({ length: 4 }, (_, i) => <li key={i} className="px-2 py-2"><Skeleton className="h-9 w-full" /></li>)}
        {pools?.length === 0 && <li className="px-3 py-4 text-[13px] text-muted">Trending data unavailable — try Tokens.</li>}
        {pools?.map((p) => (
          <li key={p.id}>
            <Link href={`/token/${p.network}/${p.base.address}`} className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-surface-2/70">
              <span className="relative"><TokenIcon src={p.base.image} symbol={p.base.symbol} size={30} /><span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[1.5px]"><ChainIcon chain={p.network} size={12} /></span></span>
              <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold truncate">{p.base.symbol}</span><span className="block text-[11.5px] text-muted">Liq {formatUsd(p.reserveUsd, 1)}</span></span>
              <span className="text-right"><span className="block text-[13.5px] num">{formatPrice(p.priceUsd)}</span><span className={clsx("block text-[12px] num", pctClass(p.change.h1))}>{formatPct(p.change.h1)} 1h</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Launchpad ─────────────────────────────────────────────────────────── */

function LaunchpadCard({ addresses }: { addresses: string[] }) {
  const [mine, setMine] = useState<{ mint: string; chain: string; symbol: string }[] | null>(null);
  const key = addresses.join(",");
  useEffect(() => {
    Promise.all(addresses.slice(0, 6).map((a) => fetch(`/api/launch/record?creator=${encodeURIComponent(a)}`).then((r) => r.json()).then((b) => (b.launches ?? []) as { mint: string; chain: string; symbol: string }[]).catch(() => [])))
      .then((l) => setMine(l.flat()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <Card className="p-4 sm:p-5" data-testid="portfolio-launchpad">
      <div className="flex items-center gap-2"><Rocket size={16} className="text-ai" /><h2 className="text-base">Launchpad</h2></div>
      <p className="text-[13px] text-muted mt-1">Create a token on Solana, Ethereum, Base or BNB Chain from your wallet, then manage it: revoke authorities, burn, lock metadata, add liquidity.</p>
      <div className="mt-3 flex items-center gap-1.5">{["solana", "ethereum", "base", "bsc"].map((c) => <span key={c} className="h-8 w-8 rounded-full bg-surface-2 grid place-items-center"><ChainIcon chain={c} size={16} /></span>)}</div>
      {mine && mine.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {mine.slice(0, 6).map((t) => <li key={t.mint}><Link href={`/token/${t.chain}/${t.mint}`} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[12.5px] font-medium"><ChainIcon chain={t.chain} size={12} />{t.symbol}</Link></li>)}
        </ul>
      )}
      <div className="mt-4 flex gap-2">
        <Link href="/launchpad#create" className="btn-ink h-10 px-4 rounded-full inline-flex items-center gap-1.5 text-[13.5px] font-semibold"><Rocket size={14} />Launch a token</Link>
        {mine && mine.length > 0 && <Link href="/launchpad#manage" className="h-10 px-4 rounded-full bg-surface-2 hover:bg-surface-3 inline-flex items-center text-[13.5px] font-medium">Manage {mine.length}</Link>}
      </div>
    </Card>
  );
}

/* ── Chart ─────────────────────────────────────────────────────────────── */

function HoldingsChart({ points, loading, up, range, hidden }: { points: HistoryPoint[]; loading: boolean; up: boolean; range: Range; hidden: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 180, pad = 6;
  if (loading && points.length < 2) return <Skeleton className="h-[180px] w-full rounded-2xl" />;
  if (points.length < 2) return <div className="h-[180px] grid place-items-center text-[13px] text-muted rounded-2xl bg-surface-2">No price history for these holdings yet.</div>;
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || hi || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const color = up ? "var(--up)" : "var(--down)";
  const hp = hover !== null ? points[hover] : null;
  const fmtT = (t: number) => new Date(t).toLocaleString(undefined, range === "24h" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: range === "7d" ? "numeric" : undefined });
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)))));
  };
  return (
    <div className="relative" data-testid="holdings-chart">
      {hp && <div className="absolute left-0 top-0 text-[12px] num pointer-events-none"><span className="font-semibold text-fg">{hidden ? "••••" : formatUsd(hp.v)}</span> <span className="text-muted">{fmtT(hp.t)}</span></div>}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[180px] touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Holdings value over ${range}`}>
        <defs>
          <linearGradient id="hold-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.26" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line}L${W},${H}L0,${H}Z`} fill="url(#hold-fill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--faint)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        <circle cx={x(hover ?? points.length - 1)} cy={y((hp ?? points[points.length - 1]).v)} r="4" fill={color} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/* ── Assets ────────────────────────────────────────────────────────────── */

function AssetList({ assets, total, hidden, loaded }: { assets: Asset[]; total: number; hidden: boolean; loaded: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? assets : assets.slice(0, 10);
  return (
    <Card data-testid="asset-list">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-base">Assets</h2>
        <span className="text-xs text-muted">{assets.length ? `${assets.length} · tap for details` : ""}</span>
      </div>
      <ul className="divide-y divide-line/70">
        {!loaded && Array.from({ length: 4 }, (_, i) => <li key={i} className="px-4 py-3"><Skeleton className="h-9" /></li>)}
        {loaded && !assets.length && <li className="px-4 py-8 text-center text-sm text-muted">No priced holdings in the selected wallets yet.</li>}
        {shown.map((a) => {
          const isOpen = open === a.key;
          return (
            <li key={a.key} data-testid="asset-row">
              <button onClick={() => setOpen(isOpen ? null : a.key)} aria-expanded={isOpen} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60 active:bg-surface-2">
                <TokenIcon src={a.icon} symbol={a.symbol} size={36} canonical />
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-semibold flex items-center gap-1.5">
                    <span className="truncate">{a.symbol}</span>
                    {a.wrappedBtc && <Badge tone="warn" title="Includes BTC represented on another network via a custodian or bridge. Not native bitcoin.">incl. wrapped</Badge>}
                  </div>
                  <div className="text-[12px] text-muted truncate">
                    {formatPrice(a.price)}
                    {a.change24h !== null && <span className={clsx("ml-1.5 num", pctClass(a.change24h))}>{formatPct(a.change24h)}</span>}
                  </div>
                </div>
                <div className="text-right num shrink-0">
                  <div className="text-[14.5px] font-medium">{hidden ? "••••" : formatUsd(a.value)}</div>
                  <div className="text-[12px] text-muted">{hidden ? "••••" : formatNumber(a.amount, a.amount < 1 ? 6 : 4)}</div>
                </div>
                <ChevronDown size={15} className={clsx("text-faint shrink-0 transition-transform", isOpen && "rotate-180")} />
              </button>
              {isOpen && <AssetDetails a={a} total={total} hidden={hidden} />}
            </li>
          );
        })}
      </ul>
      {assets.length > 10 && <button onClick={() => setAll(!all)} className="w-full py-3 text-[13px] text-brand border-t border-line/70">{all ? "Show less" : `Show all ${assets.length} assets`}</button>}
    </Card>
  );
}

interface Acq { time: number | null; bound: "exact" | "onOrBefore" | "unavailable"; source: string; priceThen: number | null }

/** First-received info per holding, loaded when the row is opened. */
function useAcquired(lots: AssetLot[]) {
  const [map, setMap] = useState<Record<string, Acq | "loading" | "error">>({});
  const key = lots.map((l) => `${l.id}:${l.network}:${l.token}`).join("|");
  useEffect(() => {
    let alive = true;
    for (const l of lots.slice(0, 6)) {
      const k = `${l.id}:${l.network}:${l.token}`;
      setMap((m) => ({ ...m, [k]: "loading" }));
      const token = l.chain === "bitcoin" ? "BTC" : l.native || (l.network === "solana" && l.symbol === "SOL") ? "native" : l.token;
      const q = new URLSearchParams({ chain: l.chain, network: l.network, address: l.address, token, symbol: l.symbol });
      fetch(`/api/wallet/acquired?${q}`).then((r) => r.json()).then((b) => { if (alive) setMap((m) => ({ ...m, [k]: b.data ?? "error" })); }).catch(() => { if (alive) setMap((m) => ({ ...m, [k]: "error" })); });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (l: AssetLot) => map[`${l.id}:${l.network}:${l.token}`];
}

function AssetDetails({ a, total, hidden }: { a: Asset; total: number; hidden: boolean }) {
  const acq = useAcquired(a.lots);
  const lots = [...a.lots].sort((x, y) => y.value - x.value);
  const times = lots.map((l) => acq(l)).filter((x): x is Acq => typeof x === "object" && x.time !== null);
  const earliest = times.length ? times.reduce((m, x) => (x.time! < m.time! ? x : m)) : null;
  const sinceThen = earliest?.priceThen && a.price ? ((a.price - earliest.priceThen) / earliest.priceThen) * 100 : null;
  const href = assetHref(lots[0]);
  const mask = (s: string) => (hidden ? "••••" : s);
  return (
    <div className="px-4 pb-4 -mt-1 rise" data-testid="asset-details">
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Fact k="Price" v={formatPrice(a.price)} />
        <Fact k="24h" v={a.change24h !== null ? <span className={pctClass(a.change24h)}>{formatPct(a.change24h)}</span> : "—"} />
        <Fact k="Share" v={total ? `${((a.value / total) * 100).toFixed(1)}%` : "—"} />
        <Fact k="Amount" v={mask(formatNumber(a.amount, a.amount < 1 ? 6 : 4))} />
        <Fact k="Value" v={mask(formatUsd(a.value))} />
        <Fact k="First received" testid="asset-acquired" v={earliest ? <>{earliest.bound === "onOrBefore" ? "≤ " : ""}{fmtDate(earliest.time!)}</> : times.length === 0 && lots.some((l) => acq(l) === "loading") ? <Skeleton className="h-4 w-20" /> : "Not indexed"} />
        {earliest?.priceThen != null && <Fact k="Price then" v={formatPrice(earliest.priceThen)} />}
        {sinceThen !== null && <Fact k="Since then" v={<span className={pctClass(sinceThen)}>{formatPct(sinceThen)}</span>} />}
      </dl>

      <div className="mt-3 text-[11px] uppercase tracking-wider text-faint">Held in</div>
      <ul className="mt-1 space-y-1">
        {lots.map((l) => {
          const r = acq(l);
          return (
            <li key={`${l.id}:${l.network}:${l.token}`} className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2">
              <ChainIcon chain={l.network === "bitcoin" ? "bitcoin" : l.network} size={16} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">{l.label} <span className="text-muted font-normal">· {l.networkName}</span></div>
                <div className="text-[11.5px] text-muted truncate">
                  {r === "loading" || r === undefined ? "Checking history…" : r === "error" || r.time === null ? "First received: not indexed" : <>First received {r.bound === "onOrBefore" ? "on or before " : ""}{fmtDate(r.time)}{r.priceThen != null && <> · {formatPrice(r.priceThen)} then</>}</>}
                </div>
              </div>
              <div className="text-right num text-[12.5px] shrink-0">
                <div>{mask(formatUsd(l.value))}</div>
                <div className="text-muted">{mask(formatNumber(l.amount, l.amount < 1 ? 6 : 4))}</div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex items-center gap-3">
        {href && <Link href={href} className="text-[13px] font-semibold text-brand">Open {a.symbol}</Link>}
        <p className="text-[11px] text-faint flex-1">First received is the first incoming transfer in public chain history, not necessarily a purchase.</p>
      </div>
    </div>
  );
}

function Fact({ k, v, testid }: { k: string; v: ReactNode; testid?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2 min-w-0" data-testid={testid}>
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="text-[13.5px] font-medium num truncate">{v}</dd>
    </div>
  );
}

/* ── Allocation ────────────────────────────────────────────────────────── */

function Allocation({ assets, total }: { assets: Asset[]; total: number }) {
  const top = assets.filter((a) => total && a.value / total >= 0.005).slice(0, 5);
  const rest = total - top.reduce((s, a) => s + a.value, 0);
  const slices = [...top.map((a) => ({ label: a.symbol, value: a.value })), ...(total && rest / total >= 0.0005 ? [{ label: "Other", value: rest }] : [])];
  if (!slices.length) return null;
  return (
    <Card className="p-4" data-testid="allocation">
      <h2 className="text-base mb-3">Allocation</h2>
      <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px]" role="img" aria-label={slices.map((s) => `${s.label} ${((s.value / total) * 100).toFixed(0)}%`).join(", ")}>
        {slices.map((s, i) => <div key={s.label} style={{ width: `${Math.max((s.value / total) * 100, 1.5)}%`, background: SLICE[i % SLICE.length] }} />)}
      </div>
      <ul className="mt-3 space-y-1.5">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: SLICE[i % SLICE.length] }} />
            <span className="flex-1 truncate">{s.label}</span>
            <span className="num font-medium">{((s.value / total) * 100).toFixed(s.value / total < 0.1 || s.value / total > 0.99 ? 1 : 0)}%</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown, Eye, EyeOff, Plug, Plus, RefreshCw, X, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { useRegistry, useWalletBalances } from "@/hooks/useWallets";
import { useBinanceSymbols } from "@/hooks/useBinanceSymbols";
import { mergeAssets, useHoldingsHistory, type Asset, type AssetLot, type HistoryPoint, type Range } from "@/hooks/useHoldingsHistory";
import { detectWatchAddress, registry, shortAddr, type TrackedWallet } from "@/lib/wallets/registry";
import { readExcluded, writeExcluded } from "@/lib/wallets/selection";
import { assetHref } from "@/lib/bajar/insights";
import { formatNumber, formatPct, formatPrice, formatUsd, pctClass, timeAgo } from "@/lib/format";
import { Badge, Card, Skeleton } from "../ui/primitives";
import { ChainIcon } from "../ui/ChainIcon";
import { TokenIcon } from "../ui/TokenIcon";
import { useWallet } from "../wallet/WalletProvider";
import { ActivityPanel } from "./ActivityPanel";

const CHAIN_ICON: Record<string, string> = { solana: "solana", evm: "ethereum", bitcoin: "bitcoin" };
const CHAIN_NAME: Record<string, string> = { solana: "Solana", evm: "EVM", bitcoin: "Bitcoin" };
const SLICE = ["#0a84ff", "#30d158", "#ff9f0a", "#bf5af2", "#ff375f", "#8e8e93"];
const HIDE_KEY = "bajar.hideBalances"; // shared with Bajar Wallet
const readHidden = () => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } };
const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * Portfolio once connected, in the Bajar Wallet's style: one balance card
 * with the chart, a minimal wallet picker and "+", then every asset with its
 * details (price, holdings per wallet, first received, price then).
 */
export function PortfolioDashboard({ side }: { side?: ReactNode }) {
  const { wallets } = useRegistry();
  const bal = useWalletBalances(wallets);
  const symbols = useBinanceSymbols();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setExcluded(readExcluded()); setHidden(readHidden()); }, []);
  const [range, setRange] = useState<Range>("7d");

  // Ignore stale exclusions (wallets that were removed).
  const ex = excluded.filter((id) => wallets.some((w) => w.id === id));
  const selectedBalances = useMemo(() => bal.balances.filter((b) => !ex.includes(b.wallet.id)), [bal.balances, ex.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const assets = useMemo(() => mergeAssets(selectedBalances), [selectedBalances]);
  const total = assets.reduce((s, a) => s + a.value, 0);
  const hist = useHoldingsHistory(assets, range, symbols);
  const first = hist.points[0]?.v ?? null;
  const change = first && hist.points.length > 1 ? total - first : null;
  const changePct = first && change !== null ? (change / first) * 100 : null;
  const mask = (s: string) => (hidden ? "••••" : s);

  const setEx = (next: string[]) => { setExcluded(next); writeExcluded(next); };
  const toggle = (id: string) => {
    const next = ex.includes(id) ? ex.filter((x) => x !== id) : [...ex, id];
    if (next.length >= wallets.length) return; // keep at least one
    setEx(next);
  };

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start" data-testid="connected-dashboard">
      <div className="contents lg:block lg:space-y-4 min-w-0">
        <Card className="p-4 sm:p-5 order-1">
          <div className="flex items-center gap-2">
            <WalletPicker wallets={wallets} values={new Map(bal.balances.map((b) => [b.wallet.id, b.error ? null : b.totalUsd]))} excluded={ex} onToggle={toggle} onAll={() => setEx([])} />
            <div className="flex-1" />
            <button onClick={bal.refresh} disabled={bal.loading} className="h-9 w-9 grid place-items-center rounded-full text-muted hover:text-fg hover:bg-surface-2" aria-label="Refresh balances" title={bal.at ? `Updated ${timeAgo(bal.at)}` : undefined}>
              <RefreshCw size={15} className={bal.loading ? "animate-spin" : ""} />
            </button>
            <AddWallet />
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
        <div className="order-4 scroll-mt-24" id="activity"><ActivityPanel /></div>
        {side && <div className="order-5">{side}</div>}
      </div>
    </div>
  );
}

/* ── Wallet picker ─────────────────────────────────────────────────────── */

function WalletPicker({ wallets, values, excluded, onToggle, onAll }: { wallets: TrackedWallet[]; values: Map<string, number | null>; excluded: string[]; onToggle: (id: string) => void; onAll: () => void }) {
  const [open, setOpen] = useState(false);
  const selected = wallets.filter((w) => !excluded.includes(w.id));
  const live = wallets.filter((w) => w.source !== "watch").length;
  const title = excluded.length === 0 ? "All wallets" : selected.length === 1 ? selected[0].label : `${selected.length} of ${wallets.length} wallets`;
  const chains = [...new Set(selected.map((w) => w.chain))];
  return (
    <>
      <button onClick={() => setOpen(true)} data-testid="wallet-picker" aria-haspopup="dialog" className="min-w-0 flex items-center gap-2 rounded-full bg-surface-2 hover:bg-surface-3 pl-1.5 pr-3 h-10 transition-colors">
        <span className="flex -space-x-1.5 shrink-0">
          {chains.slice(0, 3).map((c) => <span key={c} className="h-7 w-7 rounded-full bg-surface grid place-items-center ring-2 ring-[var(--surface-2)]"><ChainIcon chain={CHAIN_ICON[c]} size={15} /></span>)}
        </span>
        <span className="min-w-0 text-left leading-tight">
          <span className="block text-[13.5px] font-semibold truncate max-w-[150px] sm:max-w-[220px]">{title}</span>
          <span className="block text-[11px] text-muted truncate" data-testid="dashboard-wallet-count">{live} wallet{live === 1 ? "" : "s"} connected{wallets.length > live ? ` · ${wallets.length - live} watch-only` : ""}</span>
        </span>
        <ChevronDown size={15} className="text-muted shrink-0" />
      </button>
      {open && (
        <Sheet title="Wallets" onClose={() => setOpen(false)} testid="wallet-sheet">
          <ul className="space-y-1" role="group" aria-label="Wallet sources" data-testid="wallet-sources">
            <li>
              <button onClick={onAll} role="checkbox" aria-checked={excluded.length === 0} className="w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-2">
                <Tick on={excluded.length === 0} />
                <span className="flex-1 text-left text-[15px] font-medium">All wallets</span>
              </button>
            </li>
            {wallets.map((w) => {
              const on = !excluded.includes(w.id);
              const v = values.get(w.id);
              return (
                <li key={w.id} className="flex items-center gap-1">
                  <button onClick={() => onToggle(w.id)} role="checkbox" aria-checked={on} aria-pressed={on} data-testid="wallet-source" className="flex-1 min-w-0 flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-2">
                    <Tick on={on} />
                    <span className="h-8 w-8 rounded-full bg-surface-2 grid place-items-center shrink-0"><ChainIcon chain={CHAIN_ICON[w.chain]} size={16} /></span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block text-[14.5px] font-semibold truncate">{w.label}</span>
                      <span className="block text-[12px] text-muted"><span className="num">{shortAddr(w.address)}</span> · {w.source === "watch" ? "Watch-only" : w.source === "bajar" ? "Bajar Wallet" : CHAIN_NAME[w.chain]}</span>
                    </span>
                    <span className="num text-[13.5px] shrink-0">{v === undefined ? "…" : v === null ? <span className="text-down text-[12px]">Unavailable</span> : formatUsd(v)}</span>
                  </button>
                  {w.source === "watch" && <button onClick={() => registry.remove(w.id)} aria-label={`Remove ${w.label}`} className="h-9 w-9 grid place-items-center rounded-full text-faint hover:text-down hover:bg-surface-2"><X size={15} /></button>}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 px-3 text-[12px] text-faint">Pick which wallets count toward your portfolio. Saved on this device only.</p>
        </Sheet>
      )}
    </>
  );
}

const Tick = ({ on }: { on: boolean }) => <span className={clsx("h-5 w-5 rounded-full grid place-items-center shrink-0 transition-colors", on ? "bg-brand text-white" : "ring-1 ring-line-strong")}>{on && <Check size={12} strokeWidth={3} />}</span>;

/* ── Add a wallet or a watch-only address ──────────────────────────────── */

function AddWallet() {
  const [open, setOpen] = useState(false);
  const { openModal } = useWallet();
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button onClick={() => setOpen(true)} data-testid="add-wallet" aria-label="Add a wallet or watch-only address" className="h-9 w-9 grid place-items-center rounded-full btn-ink"><Plus size={18} /></button>
      {open && (
        <Sheet title="Add a wallet" onClose={() => setOpen(false)} testid="add-sheet">
          <button onClick={() => { setOpen(false); openModal(); }} className="w-full flex items-center gap-3 rounded-2xl px-3 py-3 hover:bg-surface-2">
            <span className="h-9 w-9 rounded-full bg-brand-soft text-brand grid place-items-center"><Plug size={17} /></span>
            <span className="flex-1 text-left"><span className="block text-[15px] font-semibold">Connect a wallet</span><span className="block text-[12.5px] text-muted">Phantom, MetaMask, Solflare and more</span></span>
            <ChevronRight size={16} className="text-faint" />
          </button>
          <div className="my-2 h-px bg-line" />
          <form className="px-3 pt-1 space-y-2" onSubmit={(e) => {
            e.preventDefault();
            const d = detectWatchAddress(addr);
            if (!d) { setErr("That doesn't look like a Bitcoin, EVM or Solana address."); return; }
            registry.upsert({ address: d.address, chain: d.chain, label: label.trim() || `${CHAIN_NAME[d.chain]} ${shortAddr(d.address)}`, source: "watch" });
            setAddr(""); setLabel(""); setErr(null); setOpen(false);
          }}>
            <div className="text-[15px] font-semibold">Watch an address</div>
            <p className="text-[12.5px] text-muted">Track any Bitcoin, EVM or Solana address. Watch-only: nothing can be sent from it here.</p>
            <input value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="Address" aria-label="Watch address" className="no-ring w-full h-11 rounded-xl bg-surface-2 px-3 text-[16px] num outline-none" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name (optional)" aria-label="Watch name" maxLength={40} className="no-ring w-full h-11 rounded-xl bg-surface-2 px-3 text-[16px] outline-none" />
            {err && <p className="text-[12px] text-down">{err}</p>}
            <button type="submit" className="btn-ink w-full h-11 rounded-xl font-semibold text-[15px]" data-testid="watch-add">Add address</button>
          </form>
        </Sheet>
      )}
    </>
  );
}

/** Bottom sheet on phones, centred card on larger screens. */
function Sheet({ title, onClose, children, testid }: { title: string; onClose: () => void; children: ReactNode; testid?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={title} data-testid={testid}>
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 sm:inset-x-auto sm:left-1/2 sm:top-24 sm:bottom-auto sm:-translate-x-1/2 sm:w-[440px] max-h-[85vh] overflow-y-auto rounded-t-[28px] sm:rounded-[28px] bg-[var(--surface)] p-3 pb-[calc(env(safe-area-inset-bottom)+16px)] sm:pb-4 rise">
        <div className="sm:hidden mx-auto mb-2 h-1.5 w-10 rounded-full bg-line-strong" />
        <div className="flex items-center justify-between px-3 py-1.5">
          <h2 className="text-[18px] font-semibold">{title}</h2>
          <button onClick={onClose} className="text-[15px] font-semibold text-brand">Done</button>
        </div>
        {children}
      </div>
    </div>
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

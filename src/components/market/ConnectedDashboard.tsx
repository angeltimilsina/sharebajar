"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check, ChevronDown, Plus, Settings2, Sparkles } from "lucide-react";
import clsx from "clsx";
import { useRegistry, useWalletBalances } from "@/hooks/useWallets";
import { useConnected } from "@/hooks/useConnected";
import { useBinanceSymbols } from "@/hooks/useBinanceSymbols";
import { mergeAssets, useHoldingsHistory, type Asset, type HistoryPoint, type Range } from "@/hooks/useHoldingsHistory";
import { buildAgentPortfolio, stashAgentPortfolio } from "@/lib/wallets/agent";
import { shortAddr, type TrackedWallet } from "@/lib/wallets/registry";
import { formatNumber, formatPct, formatUsd, pctClass } from "@/lib/format";
import { ChainIcon } from "../ui/ChainIcon";
import { TokenIcon } from "../ui/TokenIcon";
import { Skeleton } from "../ui/primitives";
import { CrossWalletTransfer } from "../wallets/CrossWalletTransfer";

const CHAIN_ICON: Record<string, string> = { solana: "solana", evm: "ethereum", bitcoin: "bitcoin" };
const SLICE = ["#0a84ff", "#30d158", "#ff9f0a", "#bf5af2", "#ff375f", "#8e8e93"];
const EXCLUDED_KEY = "bajar.dash.excluded";
const readExcluded = (): string[] => { try { return JSON.parse(localStorage.getItem(EXCLUDED_KEY) ?? "[]"); } catch { return []; } };

/** Market tab, once connected: holdings across your chosen wallets — chart, allocation, assets, transfers. */
export function ConnectedDashboard() {
  const { connected } = useConnected();
  const { wallets } = useRegistry();
  const bal = useWalletBalances(connected ? wallets : []);
  const symbols = useBinanceSymbols();
  const router = useRouter();
  const [excluded, setExcluded] = useState<string[]>([]);
  useEffect(() => setExcluded(readExcluded()), []);
  const [range, setRange] = useState<Range>("7d");
  const [moveOpen, setMoveOpen] = useState(false);
  const moveRef = useRef<HTMLDivElement>(null);

  const selected = wallets.filter((w) => !excluded.includes(w.id));
  const selectedBalances = bal.balances.filter((b) => !excluded.includes(b.wallet.id));
  const assets = useMemo(() => mergeAssets(selectedBalances), [selectedBalances]);
  const total = assets.reduce((s, a) => s + a.value, 0);
  const hist = useHoldingsHistory(assets, range, symbols);

  if (!connected || !wallets.length) return null;

  const toggle = (id: string) => {
    const next = excluded.includes(id) ? excluded.filter((x) => x !== id) : [...excluded, id];
    if (next.length >= wallets.length) return; // keep at least one source
    setExcluded(next);
    try { localStorage.setItem(EXCLUDED_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const selectAll = () => { setExcluded([]); try { localStorage.removeItem(EXCLUDED_KEY); } catch { /* ignore */ } };
  const openAgent = () => { stashAgentPortfolio(buildAgentPortfolio(selectedBalances)); router.push("/intelligence?agent=portfolio"); };
  const openMove = () => { setMoveOpen(true); setTimeout(() => moveRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const first = hist.points[0]?.v ?? null;
  const change = first && hist.points.length > 1 ? total - first : null;
  const changePct = first && change !== null ? (change / first) * 100 : null;
  const live = wallets.filter((w) => w.source !== "watch").length;

  return (
    <section className="space-y-3" aria-label="Your portfolio" data-testid="connected-dashboard">
      <div className="panel p-4 sm:p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[20px]">All wallets</h2>
          <span className="text-[12.5px] text-muted" data-testid="dashboard-wallet-count">{live} wallet{live === 1 ? "" : "s"} connected{wallets.length > live ? ` · ${wallets.length - live} watch-only` : ""}</span>
          <div className="flex-1" />
          <button onClick={openAgent} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-white text-[13px] font-semibold" style={{ background: "linear-gradient(135deg,#bf5af2,#0a84ff)" }} data-testid="open-agent"><Sparkles size={14} />Investment agent</button>
          <button onClick={openMove} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-surface-2 hover:bg-surface-3 text-[13px] font-semibold" data-testid="open-move"><ArrowLeftRight size={14} />Move</button>
        </div>

        {/* Wallet sources */}
        <WalletSources wallets={wallets} values={new Map(bal.balances.map((b) => [b.wallet.id, b.error ? null : b.totalUsd]))} excluded={excluded} onToggle={toggle} onAll={selectAll} />

        {/* Total + range */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <div className="text-[13px] text-muted">{selected.length === wallets.length ? "All wallets" : `${selected.length} of ${wallets.length} wallets`}</div>
            <div className="text-[36px] sm:text-[42px] font-semibold num leading-tight" data-testid="dashboard-total">{bal.at === null && bal.loading ? <Skeleton className="h-11 w-48" /> : formatUsd(total)}</div>
            {change !== null && changePct !== null && <div className={clsx("text-[14px] num", pctClass(change))}>{change >= 0 ? "+" : "−"}{formatUsd(Math.abs(change))} ({formatPct(changePct)}) <span className="text-muted">past {range}</span></div>}
          </div>
          <div className="flex-1" />
          <div role="radiogroup" aria-label="Chart range" className="flex rounded-full bg-surface-2 p-0.5">
            {(["24h", "7d", "30d"] as Range[]).map((r) => (
              <button key={r} role="radio" aria-checked={range === r} onClick={() => setRange(r)} className={clsx("h-8 px-3.5 rounded-full text-[13px] font-medium", range === r ? "seg-on text-fg" : "text-muted")}>{r}</button>
            ))}
          </div>
        </div>

        <HoldingsChart points={hist.points} loading={hist.loading || (bal.loading && !bal.at)} up={(change ?? 0) >= 0} range={range} />
        <p className="text-[11.5px] text-faint -mt-3">Today&apos;s holdings priced over the period with Binance prices{hist.flat.length ? `; ${hist.flat.slice(0, 4).join(", ")}${hist.flat.length > 4 ? "…" : ""} shown at today's value (no price history)` : ""}. Not your past balances.</p>

        {/* Allocation + assets */}
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Allocation assets={assets} total={total} />
          <AssetList assets={assets} total={total} />
        </div>
      </div>

      {/* Transfers */}
      <div ref={moveRef} className="panel p-4 sm:p-6 scroll-mt-24">
        <button onClick={() => setMoveOpen((o) => !o)} className="w-full flex items-center gap-3 text-left" aria-expanded={moveOpen}>
          <span className="h-10 w-10 rounded-full bg-brand-soft text-brand grid place-items-center shrink-0"><ArrowLeftRight size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold">Move between wallets</span>
            <span className="block text-[13px] text-muted">Pick a source and destination, choose the asset and amount, approve in the sending wallet.</span>
          </span>
          <ChevronDown size={18} className={clsx("text-muted transition-transform", moveOpen && "rotate-180")} />
        </button>
        {moveOpen && <CrossWalletTransfer wallets={wallets} balances={bal.balances} className="mt-5" />}
      </div>
    </section>
  );
}

function WalletSources({ wallets, values, excluded, onToggle, onAll }: { wallets: TrackedWallet[]; values: Map<string, number | null>; excluded: string[]; onToggle: (id: string) => void; onAll: () => void }) {
  const all = excluded.length === 0;
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-1" role="group" aria-label="Wallet sources" data-testid="wallet-sources">
      <button onClick={onAll} aria-pressed={all} className={clsx("shrink-0 rounded-2xl px-4 py-2.5 text-[13px] font-semibold transition-all", all ? "btn-ink" : "bg-surface-2 text-muted hover:text-fg")}>All</button>
      {wallets.map((w) => {
        const on = !excluded.includes(w.id);
        const v = values.get(w.id);
        return (
          <button key={w.id} onClick={() => onToggle(w.id)} aria-pressed={on} data-testid="wallet-source"
            className={clsx("shrink-0 flex items-center gap-2.5 rounded-2xl pl-2.5 pr-3.5 py-2 transition-all active:scale-[0.98]", on ? "bg-brand-soft ring-1 ring-brand/60" : "bg-surface-2 opacity-60 hover:opacity-90")}>
            <span className={clsx("h-5 w-5 rounded-full grid place-items-center shrink-0", on ? "bg-brand text-white" : "bg-surface-3")}>{on && <Check size={12} strokeWidth={3} />}</span>
            <span className="text-left">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold"><ChainIcon chain={CHAIN_ICON[w.chain]} size={13} /><span className="truncate max-w-[110px]">{w.label}</span></span>
              <span className="block text-[11.5px] text-muted num">{v === undefined ? "…" : v === null ? "Unavailable" : formatUsd(v)} · {shortAddr(w.address)}</span>
            </span>
          </button>
        );
      })}
      <Link href="/wallets#add" className="shrink-0 flex items-center gap-1.5 rounded-2xl px-3.5 py-2.5 text-[13px] text-muted border border-dashed border-line-strong hover:text-fg"><Plus size={14} />Add</Link>
      <Link href="/wallets" className="shrink-0 flex items-center gap-1.5 rounded-2xl px-3.5 py-2.5 text-[13px] text-muted hover:text-fg" aria-label="Manage wallets"><Settings2 size={14} /></Link>
    </div>
  );
}

/** Area chart with a touch/hover readout. */
function HoldingsChart({ points, loading, up, range }: { points: HistoryPoint[]; loading: boolean; up: boolean; range: Range }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 200, pad = 6;
  if (loading && points.length < 2) return <Skeleton className="h-[200px] w-full rounded-2xl" />;
  if (points.length < 2) return <div className="h-[200px] grid place-items-center text-[13px] text-muted rounded-2xl bg-surface-2">No price history for these holdings yet.</div>;
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
      {hp && (
        <div className="absolute left-0 top-0 text-[12px] num pointer-events-none">
          <span className="font-semibold text-fg">{formatUsd(hp.v)}</span> <span className="text-muted">{fmtT(hp.t)}</span>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[200px] touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Holdings value over ${range}`}>
        <defs>
          <linearGradient id="hold-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
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

function Allocation({ assets, total }: { assets: Asset[]; total: number }) {
  // Up to 5 named slices of at least 0.5%; everything smaller folds into "Other".
  const top = assets.filter((a) => total && a.value / total >= 0.005).slice(0, 5);
  const rest = total - top.reduce((s, a) => s + a.value, 0);
  const slices = [...top.map((a) => ({ label: a.symbol, value: a.value })), ...(total && rest / total >= 0.0005 ? [{ label: "Other", value: rest }] : [])];
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex lg:flex-col items-center gap-5" data-testid="allocation">
      <svg viewBox="0 0 140 140" className="w-[132px] h-[132px] shrink-0 -rotate-90" role="img" aria-label={slices.map((s) => `${s.label} ${total ? ((s.value / total) * 100).toFixed(0) : 0}%`).join(", ")}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="16" />
        {total > 0 && slices.map((s, i) => {
          const len = (s.value / total) * C;
          const el = <circle key={s.label} cx="70" cy="70" r={R} fill="none" stroke={SLICE[i % SLICE.length]} strokeWidth="16" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-acc} />;
          acc += len;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" transform="rotate(90 70 70)" fontSize="20" fontWeight="700" fill="var(--text)">{assets.length}</text>
        <text x="70" y="84" textAnchor="middle" transform="rotate(90 70 70)" fontSize="10" fill="var(--muted)">assets</text>
      </svg>
      <ul className="w-full space-y-1.5 min-w-0">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: SLICE[i % SLICE.length] }} />
            <span className="flex-1 truncate">{s.label}</span>
            <span className="num font-medium">{total ? ((s.value / total) * 100).toFixed(s.value / total < 0.1 ? 1 : 0) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssetList({ assets, total }: { assets: Asset[]; total: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? assets : assets.slice(0, 6);
  if (!assets.length) return <p className="text-[13.5px] text-muted self-center">No priced holdings in the selected wallets yet.</p>;
  return (
    <div className="min-w-0" data-testid="asset-list">
      <ul className="divide-y divide-line/60">
        {shown.map((a) => (
          <li key={a.key} className="flex items-center gap-3 py-2.5">
            <TokenIcon symbol={a.symbol} size={32} canonical />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-[14.5px]">{a.symbol}</span>
                {a.change24h !== null && <span className={clsx("text-[12px] num", pctClass(a.change24h))}>{formatPct(a.change24h)}</span>}
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden"><div className="h-full rounded-full bg-brand" style={{ width: `${total ? Math.max(2, (a.value / total) * 100) : 0}%` }} /></div>
              <div className="mt-1 flex items-center gap-1 text-[11.5px] text-muted">
                {a.wallets.slice(0, 4).map((w) => <span key={w.id} title={`${w.label}: ${formatUsd(w.value)}`} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5"><ChainIcon chain={CHAIN_ICON[w.chain]} size={10} /><span className="truncate max-w-[80px]">{w.label}</span></span>)}
                {a.wallets.length > 4 && <span>+{a.wallets.length - 4}</span>}
              </div>
            </div>
            <div className="text-right num shrink-0">
              <div className="text-[14.5px] font-medium">{formatUsd(a.value)}</div>
              <div className="text-[12px] text-muted">{formatNumber(a.amount, a.amount < 1 ? 6 : 4)}</div>
            </div>
          </li>
        ))}
      </ul>
      {assets.length > 6 && <button onClick={() => setAll(!all)} className="mt-2 text-[13px] text-brand">{all ? "Show less" : `Show all ${assets.length} assets`}</button>}
    </div>
  );
}

"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronRight, Network, RefreshCw, Sparkles, Wallet } from "lucide-react";
import clsx from "clsx";
import { useRegistry, useWalletBalances } from "@/hooks/useWallets";
import { useConnected } from "@/hooks/useConnected";
import { dayChange } from "@/lib/bajar/insights";
import { buildAgentPortfolio, stashAgentPortfolio } from "@/lib/wallets/agent";
import { shortAddr } from "@/lib/wallets/registry";
import { formatPct, formatUsd, pctClass } from "@/lib/format";
import { ChainIcon } from "../ui/ChainIcon";
import { Skeleton } from "../ui/primitives";

const CHAIN_ICON: Record<string, string> = { solana: "solana", evm: "ethereum", bitcoin: "bitcoin" };

/** Market tab, once a wallet is connected: one view of everything you hold, across wallets. */
export function ConnectedDashboard() {
  const { connected } = useConnected();
  const { wallets, maps } = useRegistry();
  const bal = useWalletBalances(connected ? wallets : []);
  const router = useRouter();
  const day = useMemo(() => dayChange(bal.holdings.map((h) => ({ ...h, usdValue: h.usdValue }))), [bal.holdings]);
  if (!connected || !wallets.length) return null;
  const live = wallets.filter((w) => w.source !== "watch").length;
  const watch = wallets.length - live;
  const openAgent = () => { stashAgentPortfolio(buildAgentPortfolio(bal.balances)); router.push("/intelligence?agent=portfolio"); };

  return (
    <section className="panel p-5 sm:p-6 relative overflow-hidden" aria-label="Your wallets" data-testid="connected-dashboard">
      <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-20 blur-3xl" style={{ background: "radial-gradient(circle, #0a84ff, transparent 70%)" }} aria-hidden />
      <div className="relative flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <div className="text-[13px] text-muted flex items-center gap-2">Total across your wallets
            <button onClick={() => location.reload()} aria-label="Refresh" className="text-muted hover:text-fg"><RefreshCw size={12} className={bal.loading ? "animate-spin" : ""} /></button>
          </div>
          <div className="text-[36px] sm:text-[42px] font-semibold num leading-tight" data-testid="dashboard-total">{bal.at === null && bal.loading ? <Skeleton className="h-11 w-48" /> : formatUsd(bal.total)}</div>
          {day.pct !== null && bal.total > 0 && (
            <div className={clsx("text-[14px] num", pctClass(day.usd))}>{day.usd >= 0 ? "+" : "−"}{formatUsd(Math.abs(day.usd))} ({formatPct(day.pct)}) <span className="text-muted">today</span></div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
            <span className="rounded-full bg-surface-2 px-2.5 py-1" data-testid="dashboard-wallet-count"><b className="num">{live}</b> wallet{live === 1 ? "" : "s"} connected</span>
            {watch > 0 && <span className="rounded-full bg-surface-2 px-2.5 py-1"><b className="num">{watch}</b> watch-only</span>}
            {maps.length > 0 && <span className="rounded-full bg-surface-2 px-2.5 py-1"><b className="num">{maps.length}</b> map{maps.length === 1 ? "" : "s"}</span>}
          </div>
        </div>
        <div className="flex-1" />
        <div className="grid grid-cols-3 gap-2 w-full sm:w-auto">
          <button onClick={openAgent} className="flex flex-col items-center gap-1.5 rounded-2xl px-3 py-2.5 hover:bg-surface-2" data-testid="open-agent">
            <span className="h-11 w-11 rounded-full grid place-items-center text-white" style={{ background: "linear-gradient(135deg,#bf5af2,#0a84ff)" }}><Sparkles size={19} /></span>
            <span className="text-[12.5px] font-medium text-center leading-tight">Investment agent</span>
          </button>
          <Link href="/wallets" className="flex flex-col items-center gap-1.5 rounded-2xl px-3 py-2.5 hover:bg-surface-2" data-testid="open-maps">
            <span className="h-11 w-11 rounded-full grid place-items-center btn-ink"><Network size={19} /></span>
            <span className="text-[12.5px] font-medium text-center leading-tight">Wallet maps</span>
          </Link>
          <Link href="/wallets#move" className="flex flex-col items-center gap-1.5 rounded-2xl px-3 py-2.5 hover:bg-surface-2">
            <span className="h-11 w-11 rounded-full grid place-items-center bg-surface-3"><ArrowLeftRight size={19} /></span>
            <span className="text-[12.5px] font-medium text-center leading-tight">Move between wallets</span>
          </Link>
        </div>
      </div>

      <ul className="relative mt-5 flex gap-2.5 overflow-x-auto no-scrollbar -mx-1 px-1" data-testid="dashboard-wallets">
        {bal.balances.length ? bal.balances.map((b) => (
          <li key={b.wallet.id} className="shrink-0 min-w-[170px] rounded-2xl bg-surface-2 px-3.5 py-3">
            <div className="flex items-center gap-2 text-[12.5px]">
              <ChainIcon chain={CHAIN_ICON[b.wallet.chain]} size={16} />
              <span className="font-medium truncate max-w-[110px]">{b.wallet.label}</span>
              {b.wallet.source === "watch" && <span className="text-[10px] text-faint">watch</span>}
            </div>
            <div className="text-[17px] font-semibold num mt-1">{b.error ? <span className="text-[12px] text-down font-normal">Unavailable</span> : formatUsd(b.totalUsd)}</div>
            <div className="text-[11px] text-faint num">{shortAddr(b.wallet.address)}</div>
          </li>
        )) : wallets.map((w) => <li key={w.id} className="shrink-0 min-w-[170px] h-[84px] skeleton rounded-2xl" />)}
        <li className="shrink-0">
          <Link href="/wallets#add" className="h-full min-h-[84px] min-w-[120px] rounded-2xl border border-dashed border-line-strong grid place-items-center text-[12.5px] text-muted hover:text-fg px-3 text-center">
            <span className="flex flex-col items-center gap-1"><Wallet size={16} />Add a wallet</span>
          </Link>
        </li>
      </ul>
      <Link href="/portfolio" className="relative mt-3 inline-flex items-center text-[13px] text-brand">Holdings and activity<ChevronRight size={14} /></Link>
    </section>
  );
}

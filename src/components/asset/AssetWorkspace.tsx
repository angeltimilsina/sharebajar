"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { ArrowLeftRight, CandlestickChart, LayoutGrid } from "lucide-react";
import { AssetExecution, type ExecAsset, type ExecMode } from "./AssetExecution";

type Mode = "overview" | ExecMode;

/**
 * One asset, three modes — Overview (analysis), Trade and Swap (execution).
 * The mode lives in the URL (?mode=trade) so it's shareable and the back
 * button works, but the page never changes: header and chart stay mounted
 * (no reload, no lost context), only the surrounding panels change.
 */
export function AssetWorkspace({ asset, header, chart, overview, rail, market, activity }: {
  asset: ExecAsset;
  header: ReactNode;
  chart: ReactNode;
  /** Overview: stats, liquidity, pairs (main column, under the chart). */
  overview: ReactNode;
  /** Overview: right rail (risk, intelligence, news…). */
  rail: ReactNode;
  /** Trade mode: order book (CEX) or pool depth note (AMM). */
  market?: ReactNode;
  /** Trade mode: live trades under the chart. */
  activity?: ReactNode;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const urlMode = sp.get("mode");
  const mode: Mode = urlMode === "trade" || urlMode === "swap" ? urlMode : "overview";
  const [side, setSide] = useState<"buy" | "sell">(sp.get("side") === "sell" ? "sell" : "buy");

  const setMode = useCallback((m: Mode, s?: "buy" | "sell") => {
    const q = new URLSearchParams(sp.toString());
    if (m === "overview") q.delete("mode"); else q.set("mode", m);
    if (s) { q.set("side", s); setSide(s); } else if (m !== "trade") q.delete("side");
    router.replace(`${path}${q.toString() ? `?${q}` : ""}`, { scroll: false });
    if (m !== "overview") requestAnimationFrame(() => document.getElementById("asset-exec")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [sp, router, path]);

  useEffect(() => { if (sp.get("side") === "sell" || sp.get("side") === "buy") setSide(sp.get("side") as "buy" | "sell"); }, [sp]);

  const exec = <AssetExecution asset={asset} mode={mode === "overview" ? "trade" : mode} onMode={(m) => setMode(m)} side={side} onSide={(s) => setMode("trade", s)} />;

  return (
    <div className="space-y-4">
      {header}

      {/* Mode switch: one asset, three views */}
      <div role="tablist" aria-label="Asset view" className="flex items-center gap-1 rounded-full bg-surface-2 p-1 w-fit max-w-full overflow-x-auto no-scrollbar">
        {([["overview", "Overview", LayoutGrid], ["trade", "Trade", CandlestickChart], ["swap", "Swap", ArrowLeftRight]] as const).map(([m, label, Icon]) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} data-testid={`mode-${m}`}
            className={clsx("inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all", mode === m ? "bg-surface text-fg shadow-[var(--shadow)]" : "text-muted hover:text-fg")}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      <div className={clsx("grid gap-4", mode === "trade" ? "lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_300px_380px]" : "xl:grid-cols-[minmax(0,1fr)_380px]")}>
        {/* Main column — the chart stays mounted across modes */}
        <div className="space-y-4 min-w-0">
          {chart}
          {mode === "overview" ? overview : mode === "trade" ? (
            <>
              <div className="xl:hidden">{market}</div>
              {activity}
            </>
          ) : null}
        </div>

        {mode === "trade" && <div className="hidden xl:block min-w-0 space-y-4">{market}</div>}

        {/* Right column — execution first in Trade/Swap; overview rail otherwise */}
        <div className="space-y-4 min-w-0" id="asset-exec">
          {mode === "overview" ? (
            <>
              <div className="hidden lg:block">{exec}</div>
              {rail}
            </>
          ) : exec}
        </div>
      </div>

      {/* Phones: contextual actions stay within reach while reading the overview */}
      {mode === "overview" && (
        <div className="lg:hidden fixed inset-x-0 z-30 px-3 pb-2 bottom-[calc(64px+env(safe-area-inset-bottom))]" data-testid="asset-actions">
          <div className="mx-auto max-w-md grid grid-cols-3 gap-2 rounded-2xl glass border border-line p-2 shadow-[var(--shadow-lg)]">
            <button onClick={() => setMode("trade", "buy")} className="h-11 rounded-xl bg-up text-white font-medium">Buy</button>
            <button onClick={() => setMode("trade", "sell")} className="h-11 rounded-xl bg-down text-white font-medium">Sell</button>
            <button onClick={() => setMode("swap")} className="h-11 rounded-xl btn-ink font-medium">Swap</button>
          </div>
        </div>
      )}
      {mode === "overview" && <div className="lg:hidden h-16" aria-hidden />}
    </div>
  );
}

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBinanceSubscription } from "@/hooks/useBinance";
import type { WsAggTrade } from "@/lib/stream/binance-ws";
import { largeTradeThreshold, buySellSummary } from "@/lib/analytics/signals";
import { mergeTrades } from "@/lib/analytics/candles";
import { formatNumber, formatPrice, formatTime, formatUsd, shortAddress } from "@/lib/format";
import { getChain } from "@/lib/chains";
import type { Trade } from "@/lib/types";
import { Badge, Card, CardHeader, Tabs } from "../ui/primitives";
import { DataStatus } from "../ui/DataStatus";
import { Whale } from "./Whale";

type Source = { kind: "binance"; symbol: string; base: string } | { kind: "dex"; chain: string; pool: string; base: string };

function useTrades(src: Source) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buf = useRef<Trade[]>([]);
  const raf = useRef<number | null>(null);
  useBinanceSubscription<WsAggTrade>(src.kind === "binance" ? `${src.symbol.toLowerCase()}@aggTrade` : null, (t) => {
    const price = +t.p, amount = +t.q;
    buf.current.unshift({ id: String(t.a), time: t.T, side: t.m ? "sell" : "buy", price, amount, notional: price * amount });
    raf.current ??= requestAnimationFrame(() => {
      raf.current = null;
      const b = buf.current;
      buf.current = [];
      setTrades((prev) => [...b, ...prev].slice(0, 400));
      setAt(Date.now());
    });
  });
  const key = src.kind === "dex" ? `${src.chain}:${src.pool}` : null;
  useEffect(() => {
    if (src.kind !== "dex") return;
    let alive = true;
    setTrades([]);
    const poll = async () => {
      try {
        const r = await fetch(`/api/dex/trades?chain=${src.chain}&pool=${src.pool}`);
        const b = await r.json();
        if (!alive) return;
        if (!r.ok) throw new Error(b.error);
        setTrades((prev) => mergeTrades(prev, b.data, 400));
        setAt(b.fetchedAt);
        setError(b.stale ? "Trade feed delayed" : null);
      } catch (e) { if (alive) setError(String((e as Error).message)); }
    };
    poll();
    const t = setInterval(() => document.visibilityState === "visible" && poll(), 4000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { trades, at, error };
}

export function TradeFeed({ source, height = 420 }: { source: Source; height?: number }) {
  const { trades, at, error } = useTrades(source);
  const [tab, setTab] = useState<"all" | "large">("all");
  const thr = useMemo(() => largeTradeThreshold(trades, source.kind === "binance" ? 50_000 : 2_500), [trades, source.kind]);
  const summary = useMemo(() => buySellSummary(trades), [trades]);
  const list = (tab === "large" ? trades.filter((t) => t.notional >= thr) : trades).slice(0, 120);
  const explorer = source.kind === "dex" ? getChain(source.chain)?.explorer : undefined;
  return (
    <Card className="flex flex-col min-w-0">
      <CardHeader
        title="Recent Trades"
        sub={<DataStatus fetchedAt={at} expectedMs={source.kind === "binance" ? 5000 : 4000} error={error} source={source.kind === "binance" ? "Binance aggTrades" : "On-chain swaps"} liveLabel={source.kind === "dex" ? "Live (polled)" : undefined} />}
        action={<Tabs size="sm" tabs={[{ id: "all", label: "All" }, { id: "large", label: <span className="inline-flex items-center gap-1"><Whale size={12} />Large</span> }]} value={tab} onChange={setTab} />}
      />
      {trades.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex justify-between text-[10.5px] text-muted mb-1 num"><span className="text-up">Buys {summary.buys} · {formatUsd(summary.buyUsd)}</span><span className="text-down">Sells {summary.sells} · {formatUsd(summary.sellUsd)}</span></div>
          <div className="h-1.5 rounded-full bg-down/50 overflow-hidden"><div className="h-full bg-up" style={{ width: `${summary.buyRatio * 100}%` }} /></div>
          <div className="text-[10px] text-faint mt-1">Large trade = ≥ {formatUsd(thr, 1)} (95th percentile of recent trades)</div>
        </div>
      )}
      <div className="overflow-y-auto scroll-thin px-3 pb-3" style={{ maxHeight: height }}>
        <table className="w-full text-[11.5px] num">
          <thead className="text-faint sticky top-0 bg-surface"><tr><th className="text-left font-normal py-1">Time</th><th className="text-right font-normal">Price</th><th className="text-right font-normal">{source.base}</th><th className="text-right font-normal">USD</th>{source.kind === "dex" && <th className="text-right font-normal">Maker</th>}</tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className={t.notional >= thr ? "bg-warn/[0.06]" : ""}>
                <td className="py-[3px] text-muted">{formatTime(t.time)}</td>
                <td className={`text-right ${t.side === "buy" ? "text-up" : "text-down"}`}>{formatPrice(t.price, { currency: false })}</td>
                <td className="text-right">{formatNumber(t.amount, 4)}</td>
                <td className="text-right">{t.notional >= thr && <Badge tone="warn" className="mr-1">LARGE</Badge>}{formatUsd(t.notional)}</td>
                {source.kind === "dex" && <td className="text-right">{t.maker ? (explorer && t.txHash ? <a href={`${explorer.tx}${t.txHash}`} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-brand">{shortAddress(t.maker, 3, 3)}</a> : shortAddress(t.maker, 3, 3)) : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="py-8 text-center text-xs text-muted">{error ? <span className="text-down">{error}</span> : tab === "large" ? "No large trades in the current window." : "Waiting for trades…"}</div>}
      </div>
    </Card>
  );
}

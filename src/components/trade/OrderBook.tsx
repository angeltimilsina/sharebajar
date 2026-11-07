"use client";
import { useMemo, useRef, useState } from "react";
import { useBinanceSubscription, useStreamStatus } from "@/hooks/useBinance";
import type { WsDepth } from "@/lib/stream/binance-ws";
import { formatNumber, formatPrice, formatUsd } from "@/lib/format";
import { Card, CardHeader } from "../ui/primitives";
import { DataStatus } from "../ui/DataStatus";

/** Live top-20 order book from Binance partial-depth stream (100ms). */
export function OrderBook({ symbol, base, rows = 12 }: { symbol: string; base: string; rows?: number }) {
  const [book, setBook] = useState<{ bids: [number, number][]; asks: [number, number][] } | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const status = useStreamStatus();
  const last = useRef(0);
  useBinanceSubscription<WsDepth>(`${symbol.toLowerCase()}@depth20@100ms`, (d) => {
    const now = Date.now();
    if (now - last.current < 250) return; // throttle renders to 4/s
    last.current = now;
    setBook({ bids: d.bids.map(([p, q]) => [+p, +q]), asks: d.asks.map(([p, q]) => [+p, +q]) });
    setAt(now);
  });
  const view = useMemo(() => {
    if (!book) return null;
    const asks = book.asks.slice(0, rows);
    const bids = book.bids.slice(0, rows);
    let ca = 0, cb = 0;
    const askRows = asks.map(([p, q]) => ({ p, q, cum: (ca += q) }));
    const bidRows = bids.map(([p, q]) => ({ p, q, cum: (cb += q) }));
    const max = Math.max(ca, cb, 1e-12);
    const spread = asks[0] && bids[0] ? asks[0][0] - bids[0][0] : null;
    const mid = asks[0] && bids[0] ? (asks[0][0] + bids[0][0]) / 2 : null;
    const bidUsd = bids.reduce((s, [p, q]) => s + p * q, 0);
    const askUsd = asks.reduce((s, [p, q]) => s + p * q, 0);
    return { askRows: askRows.reverse(), bidRows, max, spread, mid, imbalance: bidUsd / (bidUsd + askUsd || 1), bidUsd, askUsd };
  }, [book, rows]);

  return (
    <Card className="flex flex-col min-w-0">
      <CardHeader title="Order Book" sub={<DataStatus fetchedAt={status === "open" ? at : null} expectedMs={1000} source="Binance spot" error={status === "reconnecting" ? "Reconnecting…" : null} />} />
      <div className="px-3 pb-3 text-[11.5px] num">
        <div className="grid grid-cols-3 text-faint pb-1"><span>Price</span><span className="text-right">Size ({base})</span><span className="text-right">Total</span></div>
        {!view && <div className="py-10 text-center text-muted">Connecting to order book…</div>}
        {view && (
          <>
            {view.askRows.map((r) => (
              <div key={`a${r.p}`} className="relative grid grid-cols-3 py-[2px]">
                <div className="absolute inset-y-0 right-0 bg-down/10" style={{ width: `${(r.cum / view.max) * 100}%` }} />
                <span className="relative text-down">{formatPrice(r.p, { currency: false })}</span>
                <span className="relative text-right">{formatNumber(r.q, 4)}</span>
                <span className="relative text-right text-muted">{formatNumber(r.cum, 3)}</span>
              </div>
            ))}
            <div className="my-1.5 py-1.5 border-y border-line flex items-center justify-between">
              <span className="text-[13px] font-semibold">{formatPrice(view.mid)}</span>
              <span className="text-muted">Spread {view.spread !== null ? formatPrice(view.spread, { currency: false }) : "—"}{view.mid && view.spread !== null ? ` (${((view.spread / view.mid) * 100).toFixed(3)}%)` : ""}</span>
            </div>
            {view.bidRows.map((r) => (
              <div key={`b${r.p}`} className="relative grid grid-cols-3 py-[2px]">
                <div className="absolute inset-y-0 right-0 bg-up/10" style={{ width: `${(r.cum / view.max) * 100}%` }} />
                <span className="relative text-up">{formatPrice(r.p, { currency: false })}</span>
                <span className="relative text-right">{formatNumber(r.q, 4)}</span>
                <span className="relative text-right text-muted">{formatNumber(r.cum, 3)}</span>
              </div>
            ))}
            <div className="mt-2.5">
              <div className="flex justify-between text-[10.5px] text-muted mb-1"><span>Bids {formatUsd(view.bidUsd)}</span><span>Asks {formatUsd(view.askUsd)}</span></div>
              <div className="h-1.5 rounded-full bg-down/50 overflow-hidden"><div className="h-full bg-up" style={{ width: `${view.imbalance * 100}%` }} /></div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

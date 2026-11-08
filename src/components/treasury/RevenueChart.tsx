"use client";
import { useMemo, useState } from "react";
import { CHAINS } from "@/lib/chains";
import { BITCOIN_TREASURY_CHAIN, treasuryChain } from "@/lib/treasury/chainInfo";
import { fmtUsd, SERIES } from "./client";

/**
 * 30-day daily revenue, stacked by network. Colors follow the network (fixed
 * order from the chain registry), never rank. Legend + table view for access.
 */
export function RevenueChart({ daily }: { daily: { day: string; chain: string; usd: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const days = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)).toISOString().slice(0, 10));
    return out;
  }, []);
  const chains = [BITCOIN_TREASURY_CHAIN, ...CHAINS].filter((c) => daily.some((d) => d.chain === c.id));
  const color = (id: string) => SERIES[(id === "bitcoin" ? CHAINS.length : CHAINS.findIndex((c) => c.id === id)) % SERIES.length];
  const byDay = days.map((day) => ({ day, parts: chains.map((c) => ({ chain: c.id, usd: daily.filter((d) => d.day === day && d.chain === c.id).reduce((s, d) => s + d.usd, 0) })) }));
  const max = Math.max(1e-9, ...byDay.map((d) => d.parts.reduce((s, p) => s + p.usd, 0)));
  const W = 720, H = 200, pad = { l: 44, b: 22, t: 8 }, bw = (W - pad.l) / days.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const empty = !daily.length;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex flex-wrap gap-3 text-xs" aria-label="Legend">
          {chains.map((c) => <span key={c.id} className="inline-flex items-center gap-1.5 text-muted"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(c.id) }} />{c.name}</span>)}
        </div>
        <button onClick={() => setTable((t) => !t)} className="text-xs text-muted hover:text-fg">{table ? "Show chart" : "Show table"}</button>
      </div>
      {empty ? <div className="h-[200px] grid place-items-center text-xs text-muted border border-dashed border-line rounded-xl">No confirmed revenue in the last 30 days.</div> : table ? (
        <div className="max-h-[240px] overflow-y-auto scroll-thin">
          <table className="w-full text-xs num"><thead className="text-faint"><tr><th className="text-left py-1">Day</th>{chains.map((c) => <th key={c.id} className="text-right">{c.name}</th>)}<th className="text-right">Total</th></tr></thead>
            <tbody>{byDay.filter((d) => d.parts.some((p) => p.usd)).map((d) => <tr key={d.day} className="border-t border-line/60"><td className="py-1">{d.day}</td>{d.parts.map((p) => <td key={p.chain} className="text-right">{fmtUsd(p.usd)}</td>)}<td className="text-right font-semibold">{fmtUsd(d.parts.reduce((s, p) => s + p.usd, 0))}</td></tr>)}</tbody></table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[200px]" role="img" aria-label="Daily revenue by network, last 30 days">
            {ticks.map((v, i) => <g key={i}><line x1={pad.l} x2={W} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" /><text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--faint)">{fmtUsd(v)}</text></g>)}
            {byDay.map((d, i) => {
              let acc = 0;
              const x = pad.l + i * bw + 2, w = Math.max(2, bw - 4);
              return (
                <g key={d.day}>
                  {d.parts.filter((p) => p.usd > 0).map((p, j, arr) => {
                    const y0 = y(acc), y1 = y(acc + p.usd);
                    acc += p.usd;
                    const h = Math.max(1, y0 - y1 - (j < arr.length - 1 ? 2 : 0));
                    return <rect key={p.chain} x={x} y={y1} width={w} height={h} rx={j === arr.length - 1 ? 3 : 0} fill={color(p.chain)} opacity={hover === null || hover === i ? 1 : 0.45} />;
                  })}
                  <rect x={pad.l + i * bw} y={0} width={bw} height={H - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
                  {i % 5 === 0 && <text x={x + w / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--faint)">{d.day.slice(5)}</text>}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="absolute top-0 pointer-events-none panel glass px-3 py-2 text-xs num" style={{ left: `min(calc(${((pad.l + hover * bw) / W) * 100}% + 8px), calc(100% - 180px))` }}>
              <div className="font-semibold mb-1">{byDay[hover].day}</div>
              {byDay[hover].parts.filter((p) => p.usd > 0).map((p) => <div key={p.chain} className="flex justify-between gap-4"><span className="inline-flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-sm" style={{ background: color(p.chain) }} />{treasuryChain(p.chain)?.name}</span><span>{fmtUsd(p.usd)}</span></div>)}
              <div className="flex justify-between gap-4 border-t border-line mt-1 pt-1"><span className="text-muted">Total</span><span>{fmtUsd(byDay[hover].parts.reduce((s, p) => s + p.usd, 0))}</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Horizontal share bars for a breakdown (one color: magnitude, not identity). */
export function BreakdownBars({ rows, label }: { rows: { key: string; usd: number; count: number }[]; label: (k: string) => string }) {
  const max = Math.max(1e-9, ...rows.map((r) => r.usd));
  if (!rows.length) return <div className="text-xs text-muted py-4">No data yet.</div>;
  return (
    <ul className="space-y-2">
      {rows.slice(0, 8).map((r) => (
        <li key={r.key} className="text-xs">
          <div className="flex justify-between mb-1"><span>{label(r.key)}</span><span className="num text-muted">{fmtUsd(r.usd)} · {r.count}</span></div>
          <div className="h-1.5 rounded-full bg-surface-3"><div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${(r.usd / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

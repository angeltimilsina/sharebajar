"use client";
import { formatNumber, formatUsd, age } from "@/lib/format";
import { InstitutionLogo } from "../ui/InstitutionLogo";
import { useNow } from "@/hooks/useNow";
import type { DexPair, Envelope } from "@/lib/types";
import { Card, CardHeader, Stat } from "../ui/primitives";
import { useTokenPairs } from "./TokenHeader";
import { ChainIcon } from "../ui/ChainIcon";
import Link from "next/link";
import { PriceCell } from "../market/PriceCell";
import { Pct } from "../ui/primitives";

export function TokenStats({ chain, address, initial }: { chain: string; address: string; initial: Envelope<DexPair[]> }) {
  const s = useTokenPairs(chain, address, initial);
  const now = useNow(30_000);
  const pairs = s.data ?? [];
  const p = pairs[0];
  if (!p) return null;
  const totalLiq = pairs.reduce((a, x) => a + (x.liquidityUsd ?? 0), 0);
  const vol24 = pairs.reduce((a, x) => a + (x.volume.h24 ?? 0), 0);
  const supply = p.fdv && p.priceUsd ? p.fdv / p.priceUsd : null;
  return (
    <Card className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
      <Stat label="Market Cap" value={formatUsd(p.marketCap)} />
      <Stat label="FDV" value={formatUsd(p.fdv)} />
      <Stat label="Liquidity (all pairs)" value={formatUsd(totalLiq)} sub={<span className="text-muted">{pairs.length} pair{pairs.length === 1 ? "" : "s"}</span>} />
      <Stat label="24h Volume (all pairs)" value={formatUsd(vol24)} />
      <Stat label="Txns 24h" value={<><span className="text-up">{p.txns.h24.buys.toLocaleString()}</span> <span className="text-faint">/</span> <span className="text-down">{p.txns.h24.sells.toLocaleString()}</span></>} />
      <Stat label="Total Supply (≈ FDV ÷ price)" value={formatNumber(supply)} />
      <Stat label="Pair Age" value={now ? age(p.createdAt, now) : "—"} />
      <Stat label="Top DEX" value={<span className="capitalize inline-flex items-center gap-1.5"><InstitutionLogo name={p.dex} />{p.dex}</span>} />
    </Card>
  );
}

export function BuySellActivity({ chain, address, initial }: { chain: string; address: string; initial: Envelope<DexPair[]> }) {
  const s = useTokenPairs(chain, address, initial);
  const p = s.data?.[0];
  if (!p) return null;
  const rows = (["m5", "h1", "h6", "h24"] as const).map((k) => ({ k, label: { m5: "5m", h1: "1h", h6: "6h", h24: "24h" }[k], t: p.txns[k], v: p.volume[k], c: p.change[k] }));
  return (
    <Card>
      <CardHeader title="Buy / Sell Activity" sub="Top pair · transaction counts" />
      <div className="px-4 pb-4 space-y-3">
        {rows.map((r) => {
          const tot = r.t.buys + r.t.sells;
          const ratio = tot ? r.t.buys / tot : 0.5;
          return (
            <div key={r.k}>
              <div className="flex justify-between text-xs mb-1 num">
                <span className="text-muted w-10">{r.label}</span>
                <span className="text-up">{r.t.buys.toLocaleString()} buys</span>
                <span className="text-muted">Vol {formatUsd(r.v)}</span>
                <span className="text-down">{r.t.sells.toLocaleString()} sells</span>
                <Pct v={r.c} digits={1} className="w-16 text-right" />
              </div>
              <div className="h-1.5 rounded-full bg-down/50 overflow-hidden"><div className="h-full bg-up" style={{ width: `${ratio * 100}%` }} /></div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function PairsTable({ chain, address, initial }: { chain: string; address: string; initial: Envelope<DexPair[]> }) {
  const s = useTokenPairs(chain, address, initial);
  const now = useNow(30_000);
  const pairs = s.data ?? [];
  return (
    <Card>
      <CardHeader title="Liquidity Pools & Pairs" sub={`${pairs.length} pools on ${chain}`} />
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-xs text-muted border-y border-line"><tr>
            <th className="text-left px-4 py-2 font-medium">Pair</th><th className="text-left px-3 font-medium">DEX</th><th className="text-right px-3 font-medium">Price</th>
            <th className="text-right px-3 font-medium">24h</th><th className="text-right px-3 font-medium">Liquidity</th><th className="text-right px-3 font-medium">Volume 24h</th><th className="text-right px-4 font-medium">Age</th>
          </tr></thead>
          <tbody>
            {pairs.slice(0, 15).map((x) => (
              <tr key={x.pairAddress} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5"><ChainIcon chain={x.chain} size={13} /><span className="font-medium">{x.base.symbol}/{x.quote.symbol}</span></span></td>
                <td className="px-3 capitalize text-muted"><span className="inline-flex items-center gap-1.5"><InstitutionLogo name={x.dex} size={14} />{x.dex}</span>{x.labels[0] ? <span className="text-faint"> · {x.labels[0]}</span> : null}</td>
                <td className="px-3 text-right"><PriceCell value={x.priceUsd} /></td>
                <td className="px-3 text-right"><Pct v={x.change.h24} /></td>
                <td className="px-3 text-right num">{formatUsd(x.liquidityUsd)}</td>
                <td className="px-3 text-right num">{formatUsd(x.volume.h24)}</td>
                <td className="px-4 text-right text-muted num">{now ? age(x.createdAt, now) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-[11px] text-faint">Need a different pool? <Link className="text-brand" href={`/charts?chain=${chain}&token=${address}`}>Open in Charts</Link></div>
    </Card>
  );
}

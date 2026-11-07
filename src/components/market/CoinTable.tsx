"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { formatUsd } from "@/lib/format";
import { useLiveTickers } from "@/hooks/useBinance";
import { useBinanceSymbols } from "@/hooks/useBinanceSymbols";
import type { CoinMarket } from "@/lib/types";
import { Pct, Skeleton } from "../ui/primitives";
import { TokenIcon } from "../ui/TokenIcon";
import { Sparkline } from "../ui/Sparkline";
import { PriceCell } from "./PriceCell";
import { WatchStar } from "./WatchStar";

type SortKey = "rank" | "price" | "change1h" | "change24h" | "change7d" | "marketCap" | "volume24h";

/** Coin table with live Binance price overlay for the visible rows. */
export function CoinTable({ coins, loading, limit = 50, emptyText, error }: { coins: CoinMarket[]; loading?: boolean; limit?: number; emptyText?: string; error?: string | null }) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const symbols = useBinanceSymbols();
  const rows = useMemo(() => {
    const list = [...coins];
    if (sort) list.sort((a, b) => ((a[sort.key] ?? -Infinity) as number) > ((b[sort.key] ?? -Infinity) as number) ? sort.dir : -sort.dir);
    return list.slice(0, limit);
  }, [coins, sort, limit]);
  const streamSyms = rows.slice(0, 40).map((c) => symbols[c.symbol]).filter(Boolean);
  const live = useLiveTickers(streamSyms);

  const head = (key: SortKey, label: string, cls = "text-right") => (
    <th className={`px-2.5 py-2.5 font-medium whitespace-nowrap ${cls}`}>
      <button className="inline-flex items-center gap-0.5 hover:text-fg" onClick={() => setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }))}>
        {label}{sort?.key === key ? (sort.dir === -1 ? <ChevronDown size={12} /> : <ChevronUp size={12} />) : <ChevronDown size={12} className="opacity-30" />}
      </button>
    </th>
  );

  if (error && !coins.length) return <div className="p-10 text-center text-sm"><div className="text-down">Market data unavailable</div><div className="text-xs text-muted mt-1">{error} — retrying automatically. No prices are shown rather than outdated or simulated ones.</div></div>;
  if (loading && !coins.length) return <div className="p-4 space-y-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (!rows.length) return <div className="p-10 text-center text-sm text-muted">{emptyText ?? "No markets to show."}</div>;

  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full text-sm min-w-[860px]">
        <thead className="text-xs text-muted border-b border-line">
          <tr>
            <th className="w-10" /><th className="px-2 py-2.5 font-medium text-left w-10">#</th>
            <th className="px-3 py-2.5 font-medium text-left">Token</th>
            {head("price", "Price")}{head("change1h", "1h %")}{head("change24h", "24h %")}{head("change7d", "7d %")}
            {head("marketCap", "Market Cap")}{head("volume24h", "24h Volume")}
            <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Last 7 Days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const sym = symbols[c.symbol];
            const l = sym ? live[sym] : undefined;
            // Only trust the live overlay if it agrees with the aggregate price within 3% (guards symbol collisions).
            const useLive = l && c.price && Math.abs(l.price - c.price) / c.price < 0.03;
            const price = useLive ? l!.price : c.price;
            const ch24 = useLive ? l!.change24h : c.change24h;
            return (
              <tr key={c.id} onClick={() => router.push(`/coin/${c.id}`)} className="border-b border-line/60 last:border-0 hover:bg-surface-2/70 cursor-pointer">
                <td className="pl-4 pr-1 py-3"><WatchStar item={{ kind: "coin", id: c.id, label: c.symbol }} /></td>
                <td className="px-2 py-3 text-muted num">{c.rank ?? "—"}</td>
                <td className="px-3 py-3">
                  <Link href={`/coin/${c.id}`} className="flex items-center gap-2.5 min-w-0" onClick={(e) => e.stopPropagation()}>
                    <TokenIcon src={c.image} symbol={c.symbol} size={28} />
                    <span className="font-semibold truncate max-w-[130px]">{c.name}</span>
                    <span className="text-muted text-xs">{c.symbol}</span>
                  </Link>
                </td>
                <td className="px-2.5 py-3 text-right"><PriceCell value={price} live={!!useLive} /></td>
                <td className="px-2.5 py-3 text-right"><Pct v={c.change1h} /></td>
                <td className="px-2.5 py-3 text-right"><Pct v={ch24} /></td>
                <td className="px-2.5 py-3 text-right"><Pct v={c.change7d} /></td>
                <td className="px-2.5 py-3 text-right num">{formatUsd(c.marketCap)}</td>
                <td className="px-2.5 py-3 text-right num">{formatUsd(c.volume24h)}</td>
                <td className="px-3 py-2 text-right"><Sparkline data={c.sparkline} width={96} height={32} className="ml-auto" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

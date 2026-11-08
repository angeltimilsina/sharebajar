"use client";
import Link from "next/link";
import { usePoll } from "@/hooks/usePoll";
import { poolSignals } from "@/lib/analytics/signals";
import { formatPrice, formatUsd } from "@/lib/format";
import type { Pool } from "@/lib/types";
import { Badge, Card, CardHeader, Pct } from "../ui/primitives";
import { DataStatus } from "../ui/DataStatus";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainLabel } from "../ui/ChainIcon";

/** Deterministic unusual-activity detector over trending pools. */
export function SignalsFeed() {
  const s = usePoll<Pool[]>("/api/dex/pools?feed=trending&duration=1h", 60_000);
  const items = (s.data ?? []).map((p) => ({ p, sig: poolSignals(p) })).filter((x) => x.sig.length).slice(0, 10);
  return (
    <Card>
      <CardHeader title="Unusual Activity" sub={<DataStatus fetchedAt={s.fetchedAt} expectedMs={60_000} stale={s.stale} error={s.error} source="Trending pools · rule-based signals" />} />
      <ul className="px-2 pb-2">
        {!items.length && <li className="px-3 py-6 text-xs text-muted text-center">{s.loading ? "Scanning pools…" : s.error ?? "No unusual activity detected right now."}</li>}
        {items.map(({ p, sig }) => (
          <li key={p.id}>
            <Link href={`/token/${p.network}/${p.base.address}?pair=${p.address}`} className="block px-2 py-2.5 rounded-lg hover:bg-surface-2">
              <div className="flex items-center gap-2.5">
                <TokenIcon src={p.base.image} symbol={p.base.symbol} size={26} />
                <span className="font-semibold text-sm">{p.base.symbol}</span><ChainLabel chain={p.network} />
                <span className="flex-1" />
                <span className="text-right text-xs num"><span className="block">{formatPrice(p.priceUsd)}</span><Pct v={p.change.h1} digits={1} /></span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5 pl-9">{sig.map((x) => <Badge key={x.label} tone={x.tone === "up" ? "up" : x.tone === "down" ? "down" : x.tone === "warn" ? "warn" : "info"} title={x.detail}>{x.label}</Badge>)}<span className="text-[10.5px] text-faint num">Liq {formatUsd(p.reserveUsd)} · Vol {formatUsd(p.volume.h24)}</span></div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

"use client";
import { useState } from "react";
import { BadgeCheck, Copy, Check, ExternalLink, Globe } from "lucide-react";
import { usePoll } from "@/hooks/usePoll";
import { formatPrice, shortAddress } from "@/lib/format";
import { getChain } from "@/lib/chains";
import type { DexPair, Envelope } from "@/lib/types";
import { Badge, Pct } from "../ui/primitives";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainIcon } from "../ui/ChainIcon";
import { DataStatus } from "../ui/DataStatus";
import { PriceCell } from "../market/PriceCell";
import { TokenActions } from "../market/TokenActions";

export function useTokenPairs(chain: string, address: string, initial: Envelope<DexPair[]>) {
  return usePoll<DexPair[]>(`/api/dex/pairs?chain=${chain}&address=${address}`, 10_000, initial);
}

export function TokenHeader({ chain, address, initial, image, verified, socials }: {
  chain: string; address: string; initial: Envelope<DexPair[]>; image: string | null;
  verified: { label: string; tone: "up" | "brand" | "info" }[];
  socials: { label: string; url: string }[];
}) {
  const s = useTokenPairs(chain, address, initial);
  const p = s.data?.[0];
  const c = getChain(chain)!;
  const [copied, setCopied] = useState(false);
  if (!p) return null;
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative">
          <TokenIcon src={image ?? p.imageUrl} symbol={p.base.symbol} size={48} />
          <span className="absolute -bottom-1 -right-1 rounded-full bg-surface p-0.5"><ChainIcon chain={chain} size={16} /></span>
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 flex-wrap">
            <span className="truncate max-w-[340px]">{p.base.name}</span>
            <span className="text-muted text-base font-medium">{p.base.symbol}</span>
            {verified.map((v) => <Badge key={v.label} tone={v.tone}><BadgeCheck size={11} /> {v.label}</Badge>)}
          </h1>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted flex-wrap">
            <span className="inline-flex items-center gap-1"><ChainIcon chain={chain} size={12} />{c.name}</span>
            <span className="text-faint">·</span>
            <button onClick={() => { navigator.clipboard?.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="num inline-flex items-center gap-1 hover:text-fg" title="Copy contract address">
              {shortAddress(address, 6, 6)} {copied ? <Check size={11} className="text-up" /> : <Copy size={11} />}
            </button>
            <a href={`${c.explorer.token}${address}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:text-fg">Explorer <ExternalLink size={10} /></a>
            {socials.slice(0, 4).map((x) => <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:text-fg"><Globe size={11} />{x.label}</a>)}
          </div>
        </div>
      </div>
      <div>
        <div className="flex items-baseline gap-3">
          <PriceCell value={p.priceUsd} className="text-3xl font-bold tracking-tight" />
          <Pct v={p.change.h24} className="text-sm font-semibold" />
        </div>
        <div className="flex items-center gap-3 text-[11px] mt-0.5">
          <DataStatus fetchedAt={s.fetchedAt} expectedMs={10_000} stale={s.stale} error={s.error} source="DexScreener" />
          <span className="text-muted">5m <Pct v={p.change.m5} digits={1} /></span>
          <span className="text-muted">1h <Pct v={p.change.h1} digits={1} /></span>
          <span className="text-muted">6h <Pct v={p.change.h6} digits={1} /></span>
        </div>
        {p.priceNative !== null && <div className="text-[11px] text-faint num mt-0.5">{formatPrice(p.priceNative, { currency: false })} {p.quote.symbol}</div>}
      </div>
      <div className="flex-1" />
      <TokenActions watch={{ kind: "token", id: address, chain, address, label: p.base.symbol }} />
    </div>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";
import { Share2, Check, ArrowLeftRight, CandlestickChart } from "lucide-react";
import { Button } from "../ui/primitives";
import { WatchStar } from "./WatchStar";
import type { WatchInput } from "@/hooks/useWatchlist";

export function TokenActions({ watch, swapHref, tradeHref, swapDisabledReason }: { watch: WatchInput; swapHref?: string; tradeHref?: string; swapDisabledReason?: string }) {
  const [shared, setShared] = useState(false);
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else { await navigator.clipboard.writeText(url); setShared(true); setTimeout(() => setShared(false), 1500); }
    } catch { /* cancelled */ }
  };
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="h-10 w-10 grid place-items-center rounded-xl border border-line bg-surface"><WatchStar item={watch} size={18} /></span>
      <button onClick={share} aria-label="Share" className="h-10 w-10 grid place-items-center rounded-xl border border-line bg-surface hover:bg-surface-2">{shared ? <Check size={17} className="text-up" /> : <Share2 size={17} />}</button>
      {tradeHref && <Link href={tradeHref}><Button variant="subtle"><CandlestickChart size={16} /> Trade view</Button></Link>}
      {swapHref ? (
        <>
          <Link href={swapHref}><Button className="bg-up hover:bg-up text-black">Buy</Button></Link>
          <Link href={`${swapHref}&side=sell`}><Button variant="danger">Sell</Button></Link>
          <Link href={swapHref}><Button variant="outline"><ArrowLeftRight size={16} /> Swap</Button></Link>
        </>
      ) : (
        <Button variant="subtle" disabled title={swapDisabledReason ?? "Swaps are currently available for Solana tokens only"}>Swap unavailable</Button>
      )}
    </div>
  );
}

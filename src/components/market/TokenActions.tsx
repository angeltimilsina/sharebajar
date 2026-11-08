"use client";
import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { WatchStar } from "./WatchStar";
import type { WatchInput } from "@/hooks/useWatchlist";

/** Watchlist + share. Trade/Swap are execution modes of the asset page itself (see AssetWorkspace). */
export function TokenActions({ watch }: { watch: WatchInput }) {
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
      <span className="h-10 w-10 grid place-items-center rounded-full border border-line bg-surface"><WatchStar item={watch} size={18} /></span>
      <button onClick={share} aria-label="Share" className="h-10 w-10 grid place-items-center rounded-full border border-line bg-surface hover:bg-surface-2">{shared ? <Check size={17} className="text-up" /> : <Share2 size={17} />}</button>
    </div>
  );
}

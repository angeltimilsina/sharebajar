"use client";
import { Star } from "lucide-react";
import { useWatchlist, watchKey, type WatchInput } from "@/hooks/useWatchlist";

export function WatchStar({ item, size = 16 }: { item: WatchInput; size?: number }) {
  const { has, toggle } = useWatchlist();
  const on = has(watchKey(item));
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(item); }}
      aria-label={on ? `Remove ${item.label} from watchlist` : `Add ${item.label} to watchlist`}
      aria-pressed={on}
      className="p-1 -m-1 rounded hover:bg-surface-3"
    >
      <Star size={size} className={on ? "fill-warn text-warn" : "text-faint hover:text-muted"} />
    </button>
  );
}

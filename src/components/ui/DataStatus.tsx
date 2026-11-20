"use client";
import clsx from "clsx";
import { useNow } from "@/hooks/useNow";
import { formatTime, timeAgo } from "@/lib/format";

export type Freshness = "live" | "delayed" | "stale" | "error" | "loading";

/** Decide freshness from the age of the data vs the expected update cadence. */
export function freshness(fetchedAt: number | null, expectedMs: number, opts: { stale?: boolean; error?: string | null; now?: number } = {}): Freshness {
  if (!fetchedAt) return opts.error ? "error" : "loading";
  if (opts.stale) return "stale";
  const age = (opts.now ?? Date.now()) - fetchedAt;
  if (age > Math.max(expectedMs * 6, 5 * 60_000)) return "stale";
  if (age > Math.max(expectedMs * 2.5, 15_000)) return "delayed";
  return "live";
}

const LABEL: Record<Freshness, string> = { live: "Live", delayed: "Delayed", stale: "Stale", error: "Unavailable", loading: "Loading" };

/**
 * Small freshness badge used everywhere real-time data is shown.
 * "Live" only appears when the data is genuinely recent.
 */
export function DataStatus({ fetchedAt, expectedMs, stale, error, source, className, compact, liveLabel }: {
  fetchedAt: number | null; expectedMs: number; stale?: boolean; error?: string | null; source?: string | null; className?: string; compact?: boolean; liveLabel?: string;
}) {
  const now = useNow(1000);
  if (!now) return <span className={clsx("inline-flex items-center gap-1.5 text-[11px] text-faint", className)}><span className="h-1.5 w-1.5 rounded-full bg-faint" />…</span>;
  const f = freshness(fetchedAt, expectedMs, { stale, error, now });
  const title = [source && `Source: ${source}`, fetchedAt && `Updated ${formatTime(fetchedAt)} (${timeAgo(fetchedAt, now)})`, error].filter(Boolean).join(" · ");
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap", className)}>
      <span
        className={clsx(
          "h-1.5 w-1.5 rounded-full",
          f === "live" && "bg-up pulse-dot shadow-[0_0_6px_var(--up)]",
          f === "delayed" && "bg-warn",
          (f === "stale" || f === "error") && "bg-down",
          f === "loading" && "bg-faint",
        )}
      />
      <span className={clsx(f === "live" ? "text-up" : f === "delayed" ? "text-warn" : f === "loading" ? "text-faint" : "text-down")}>
        {f === "live" && liveLabel ? liveLabel : LABEL[f]}
      </span>
      {!compact && fetchedAt && f !== "live" && <span className="text-faint">· {timeAgo(fetchedAt, now)}</span>}
      {!compact && source && <span className="text-faint hidden sm:inline">· {source}</span>}
    </span>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { formatPrice } from "@/lib/format";

/** Price that briefly flashes green/red when it ticks. */
export function PriceCell({ value, live, className }: { value: number | null | undefined; live?: boolean; className?: string }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<"" | "flash-up" | "flash-down">("");
  const [n, setN] = useState(0);
  useEffect(() => {
    if (value != null && prev.current != null && value !== prev.current) {
      setFlash(value > prev.current ? "flash-up" : "flash-down");
      setN((x) => x + 1);
    }
    prev.current = value;
  }, [value]);
  return (
    <span key={n} className={clsx("num rounded px-1 -mx-1", flash, className)} title={live ? "Live price (Binance stream)" : "CoinGecko price (updates every minute)"}>
      {formatPrice(value)}
    </span>
  );
}

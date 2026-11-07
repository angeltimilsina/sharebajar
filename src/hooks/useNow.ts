"use client";
import { useEffect, useState } from "react";

/**
 * Ticking clock. Returns 0 during SSR and the first client render so that
 * time-relative text never causes hydration mismatches.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

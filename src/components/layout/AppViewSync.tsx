"use client";
import { useEffect } from "react";
import { useConnected } from "@/hooks/useConnected";

/** Marks the page as an app view once a wallet is connected (hides the marketing footer site-wide). */
export function AppViewSync() {
  const { connected } = useConnected();
  useEffect(() => {
    const el = document.documentElement;
    if (connected) el.setAttribute("data-app-view", "connected");
    else el.removeAttribute("data-app-view");
  }, [connected]);
  return null;
}

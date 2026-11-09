"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useConnected } from "@/hooks/useConnected";

/** App pages: each has its own experience, so no marketing footer. */
const APP_PAGES = /^\/(discover|trade|portfolio|wallet)(\/|$)/;

/** Marks the page as an app view (hides the footer): on app pages, and site-wide once a wallet is connected. */
export function AppViewSync() {
  const { connected } = useConnected();
  const path = usePathname();
  const app = connected || APP_PAGES.test(path);
  useEffect(() => {
    const el = document.documentElement;
    if (app) el.setAttribute("data-app-view", connected ? "connected" : "page");
    else el.removeAttribute("data-app-view");
  }, [app, connected]);
  return null;
}

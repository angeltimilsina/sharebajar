"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import clsx from "clsx";
import { Logo } from "../ui/Logo";
import { GlobalSearch, SearchTrigger } from "./CommandSearch";
import { ThemeToggle } from "./ThemeToggle";
import { ConnectButton } from "../wallet/ConnectButton";

/**
 * The four stages of one journey: overview → find → execute → manage.
 * `match` keeps the right tab highlighted on related pages (asset detail
 * belongs to the stage it was opened from).
 */
export const NAV: { href: string; label: string; match: RegExp }[] = [
  { href: "/", label: "Market", match: /^\/($|coin\/)/ },
  { href: "/discover", label: "Discover", match: /^\/(discover|token|launchpad)/ },
  { href: "/trade", label: "Trade", match: /^\/(trade|charts)/ },
  { href: "/portfolio", label: "Portfolio", match: /^\/(portfolio|wallet)/ },
];

/** Secondary destinations, reachable from the menu. */
export const MORE: { href: string; label: string; ai?: boolean; hint: string }[] = [
  { href: "/intelligence", label: "Bajar Intelligence", ai: true, hint: "Ask about any market" },
  { href: "/launchpad", label: "New launches", hint: "Pools created minutes ago" },
  { href: "/wallet", label: "Bajar Wallet", hint: "Self-custody BTC · EVM · Solana" },
  { href: "/status", label: "System status", hint: "Live data sources" },
];

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string) => NAV.find((n) => n.href === href)?.match.test(path) ?? path === href;
  return (
    <header className="sticky top-0 z-40 glass border-b border-line">
      <div className="mx-auto max-w-[1680px] px-4 lg:px-6 h-14 sm:h-16 flex items-center gap-2 sm:gap-3 xl:gap-6">
        <Logo menuOpen={open} onMenu={() => setOpen((o) => !o)} />
        <nav className="hidden lg:flex items-center gap-0.5" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={clsx("relative px-3 py-1.5 rounded-full text-[14px] font-medium transition-colors", isActive(n.href) ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <SearchTrigger className="hidden 2xl:flex items-center gap-2 h-10 w-[340px] rounded-full bg-surface-2 px-4 text-muted hover:bg-surface-3" />
        <SearchTrigger className="2xl:hidden h-10 w-10 grid place-items-center rounded-full text-muted hover:text-fg hover:bg-surface-2 [&>span]:hidden [&>kbd]:hidden" />
        <div className="hidden sm:block"><ThemeToggle /></div>
        <div className="hidden sm:block"><ConnectButton /></div>
        <div className="sm:hidden"><ConnectButton compact /></div>
      </div>
      <GlobalSearch />
      {open && (
        <nav className="border-t border-line px-3 py-3 grid gap-0.5 rise max-w-[1680px] mx-auto w-full" aria-label="Mobile">
          <div className="lg:hidden grid gap-0.5">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={clsx("px-3.5 py-3 rounded-xl text-[16px]", isActive(n.href) ? "bg-surface-2 text-fg font-medium" : "text-muted")}>{n.label}</Link>
            ))}
          </div>
          <div className="px-3.5 pt-3 pb-1 text-[11px] uppercase tracking-wider text-faint">More</div>
          {MORE.map((m) => (
            <Link key={m.href} href={m.href} className={clsx("px-3.5 py-2.5 rounded-xl flex items-baseline justify-between gap-3", path.startsWith(m.href) ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}>
              <span className="text-[15px]">{m.label}{m.ai && <span className="ml-2 rounded-full bg-ai/15 text-ai text-[10px] font-semibold px-1.5 py-0.5">AI</span>}</span>
              <span className="text-xs text-faint truncate">{m.hint}</span>
            </Link>
          ))}
          <div className="flex items-center gap-2 pt-2 sm:hidden"><ThemeToggle /><span className="text-xs text-muted">Theme</span></div>
        </nav>
      )}
    </header>
  );
}

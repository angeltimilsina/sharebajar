"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import clsx from "clsx";
import { Logo } from "../ui/Logo";
import { GlobalSearch, SearchTrigger } from "./CommandSearch";
import { ThemeToggle } from "./ThemeToggle";
import { ConnectButton } from "../wallet/ConnectButton";

export const NAV = [
  { href: "/", label: "Market" },
  { href: "/discover", label: "Discover" },
  { href: "/trade", label: "Trade" },
  { href: "/charts", label: "Charts" },
  { href: "/launchpad", label: "Launchpad" },
  { href: "/intelligence", label: "Intelligence", ai: true },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/wallet", label: "Wallet" },
];

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-40 glass border-b border-line">
      <div className="mx-auto max-w-[1680px] px-4 lg:px-6 h-14 sm:h-16 flex items-center gap-2 sm:gap-3 xl:gap-6">
        <button className="xl:hidden -ml-1.5 h-10 w-10 grid place-items-center rounded-full text-muted hover:text-fg hover:bg-surface-2" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Logo />
        <nav className="hidden xl:flex items-center gap-0.5 2xl:gap-2" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={clsx("relative px-3 py-1.5 rounded-full text-[14px] font-medium transition-colors", isActive(n.href) ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}>
              {n.label}
              {n.ai && <span className="ml-1.5 rounded-full bg-ai/15 text-ai text-[10px] font-semibold px-1.5 py-0.5 align-middle">AI</span>}
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
        <nav className="xl:hidden border-t border-line px-3 py-3 grid gap-0.5 rise" aria-label="Mobile">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={clsx("px-3.5 py-3 rounded-xl text-[16px]", isActive(n.href) ? "bg-surface-2 text-fg font-medium" : "text-muted")}>
              {n.label}{n.ai && <span className="ml-2 rounded-full bg-ai/15 text-ai text-[10px] font-semibold px-1.5 py-0.5">AI</span>}
            </Link>
          ))}
          <div className="flex items-center gap-2 pt-2 sm:hidden"><ThemeToggle /><span className="text-xs text-muted">Theme</span></div>
        </nav>
      )}
    </header>
  );
}

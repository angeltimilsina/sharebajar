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
];

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-40 border-b border-line glass">
      <div className="mx-auto max-w-[1680px] px-4 lg:px-6 h-16 flex items-center gap-3 xl:gap-6">
        <button className="xl:hidden -ml-1 p-2 rounded-lg hover:bg-surface-2" onClick={() => setOpen((o) => !o)} aria-label="Menu">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Logo />
        <nav className="hidden xl:flex items-center gap-0.5 2xl:gap-2" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={clsx("relative px-2.5 py-2 text-[14.5px] font-medium transition-colors", isActive(n.href) ? "text-fg" : "text-muted hover:text-fg")}>
              {n.label}
              {n.ai && <span className="ml-1.5 rounded-md bg-ai/20 text-ai text-[10px] font-bold px-1.5 py-0.5 align-middle">AI</span>}
              {isActive(n.href) && <span className="absolute left-2.5 right-2.5 -bottom-[13px] h-[2px] rounded-full bg-brand shadow-[0_0_10px_var(--brand)]" />}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <SearchTrigger className="hidden 2xl:flex items-center gap-2 h-10 w-[340px] rounded-xl border border-line bg-surface px-3 hover:border-line-strong" />
        <SearchTrigger className="2xl:hidden h-10 w-10 grid place-items-center rounded-xl border border-line bg-surface [&>span]:hidden [&>kbd]:hidden" />
        <div className="hidden sm:block"><ThemeToggle /></div>
        <div className="hidden sm:block"><ConnectButton /></div>
        <div className="sm:hidden"><ConnectButton compact /></div>
      </div>
      <GlobalSearch />
      {open && (
        <nav className="xl:hidden border-t border-line px-4 py-3 grid gap-1" aria-label="Mobile">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={clsx("px-3 py-2.5 rounded-lg text-[15px] font-medium", isActive(n.href) ? "bg-surface-2 text-fg" : "text-muted")}>
              {n.label}{n.ai && <span className="ml-2 rounded bg-ai/20 text-ai text-[10px] font-bold px-1.5 py-0.5">AI</span>}
            </Link>
          ))}
          <div className="flex items-center gap-2 pt-2 sm:hidden"><ThemeToggle /><span className="text-xs text-muted">Theme</span></div>
        </nav>
      )}
    </header>
  );
}

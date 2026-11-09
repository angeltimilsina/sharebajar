"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { Logo } from "../ui/Logo";
import { GlobalSearch, SearchTrigger } from "./CommandSearch";
import { useConnected } from "@/hooks/useConnected";
import { sidebar, useSidebar } from "@/lib/ui/sidebar";

/**
 * Main tabs: the token marketplace and the launchpad. Wallet things live in
 * the left sidebar; everything else is under "More".
 */
export const NAV: { href: string; label: string; match: RegExp }[] = [
  { href: "/tokens", label: "Tokens", match: /^\/(tokens|token\/)/ },
  { href: "/launchpad", label: "Launchpad", match: /^\/launchpad/ },
];

/** Secondary destinations, in the "More" menu. */
export const MORE: { href: string; label: string; ai?: boolean; hint: string }[] = [
  { href: "/", label: "Markets", hint: "Prices, gainers and losers" },
  { href: "/trade", label: "Trade", hint: "Swap with your wallet" },
  { href: "/discover", label: "Discover", hint: "Trending pools on every chain" },
  { href: "/intelligence", label: "Bajar Intelligence", ai: true, hint: "Ask about any market" },
  { href: "/status", label: "System status", hint: "Live data sources" },
];

export function Header() {
  const path = usePathname();
  const { connected } = useConnected();
  const { drawer, collapsed } = useSidebar();
  const isActive = (href: string) => NAV.find((n) => n.href === href)?.match.test(path) ?? path === href;
  return (
    <header className="sticky top-0 z-40 glass border-b-[0.5px] border-line">
      <div className="mx-auto max-w-[1680px] px-4 lg:px-6 h-14 sm:h-16 flex items-center gap-2 sm:gap-3 xl:gap-6">
        <Logo menuOpen={drawer} onMenu={() => sidebar.toggle()} connected={connected} menuLabel={collapsed ? "Expand wallet panel" : "Wallet panel"} />
        <nav className="hidden md:flex items-center gap-0.5" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={clsx("relative px-3 py-1.5 rounded-full text-[14px] font-medium transition-colors", isActive(n.href) ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}>
              {n.label}
            </Link>
          ))}
          <MoreMenu path={path} />
        </nav>
        <div className="flex-1" />
        <SearchTrigger className="hidden 2xl:flex items-center gap-2 h-10 w-[340px] rounded-full bg-surface-2 px-4 text-muted hover:bg-surface-3" />
        <SearchTrigger className="2xl:hidden h-10 w-10 grid place-items-center rounded-full text-muted hover:text-fg hover:bg-surface-2 [&>span]:hidden [&>kbd]:hidden" />
        <div className="md:hidden"><MoreMenu path={path} icon /></div>
      </div>
      <GlobalSearch />
    </header>
  );
}

function MoreMenu({ path, icon }: { path: string; icon?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const inMore = MORE.some((m) => (m.href === "/" ? path === "/" || path.startsWith("/coin/") : path.startsWith(m.href)));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={icon ? "More pages" : undefined}
        data-testid={icon ? "more-menu-mobile" : "more-menu"}
        className={icon
          ? clsx("h-10 w-10 grid place-items-center rounded-full text-muted hover:text-fg hover:bg-surface-2", open && "bg-surface-2 text-fg")
          : clsx("px-3 py-1.5 rounded-full text-[14px] font-medium inline-flex items-center gap-1 transition-colors", open || inMore ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}
      >
        {icon ? <MoreHorizontal size={20} /> : <>More <ChevronDown size={14} className={clsx("transition-transform", open && "rotate-180")} /></>}
      </button>
      {open && (
        <div role="menu" className={clsx("absolute top-full mt-2 w-[280px] panel p-1.5 rise shadow-xl z-50", icon ? "right-0" : "left-0")}>
          {MORE.map((m) => {
            const on = m.href === "/" ? path === "/" : path.startsWith(m.href);
            return (
              <Link key={m.href} href={m.href} role="menuitem" onClick={() => setOpen(false)}
                className={clsx("block px-3 py-2.5 rounded-xl", on ? "bg-surface-2 text-fg" : "text-muted hover:text-fg hover:bg-surface-2")}>
                <span className="text-[15px] font-medium">{m.label}{m.ai && <span className="ml-2 rounded-full bg-ai/15 text-ai text-[10px] font-semibold px-1.5 py-0.5">AI</span>}</span>
                <span className="block text-xs text-faint">{m.hint}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

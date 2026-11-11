"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Logo } from "../ui/Logo";
import { GlobalSearch, SearchTrigger } from "./CommandSearch";
import { useConnected } from "@/hooks/useConnected";
import { sidebar, useSidebar } from "@/lib/ui/sidebar";
import { AccountButton } from "./AccountButton";

/**
 * Main tabs: the token marketplace and the launchpad. Your account, wallet
 * controls and the other pages live in the Account button.
 */
export const NAV: { href: string; label: string; match: RegExp }[] = [
  { href: "/tokens", label: "Tokens", match: /^\/(tokens|token\/)/ },
  { href: "/launchpad", label: "Launchpad", match: /^\/launchpad/ },
];

/** Secondary destinations, listed in the Account menu. */
export const MORE: { href: string; label: string; ai?: boolean; hint: string }[] = [
  { href: "/", label: "Markets", hint: "Prices, gainers and losers" },
  { href: "/trade", label: "Trade", hint: "Swap with your wallet" },
  { href: "/discover", label: "Discover", hint: "Trending pools on every chain" },
  { href: "/intelligence", label: "Bajar Intelligence", ai: true, hint: "Ask about any market" },
  { href: "/learn", label: "Learn", hint: "Lessons + student sandbox (test coins)" },
  { href: "/pro", label: "Bajar Pro", hint: "Advanced investment agent" },
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
        {/* The wallet side menu exists only before a wallet is connected; after that, the Account button has it all. */}
        <Logo menuOpen={drawer} onMenu={connected ? undefined : () => sidebar.toggle()} connected={connected} menuLabel={collapsed ? "Expand wallet panel" : "Wallet panel"} />
        <nav className="hidden md:flex items-center gap-0.5" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={clsx("relative px-3 py-1.5 rounded-full text-[14px] font-medium transition-colors", isActive(n.href) ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <SearchTrigger className="hidden 2xl:flex items-center gap-2 h-10 w-[340px] rounded-full bg-surface-2 px-4 text-muted hover:bg-surface-3" />
        <SearchTrigger className="2xl:hidden h-10 w-10 grid place-items-center rounded-full text-muted hover:text-fg hover:bg-surface-2 [&>span]:hidden [&>kbd]:hidden" />
        <AccountButton />
      </div>
      <GlobalSearch />
    </header>
  );
}

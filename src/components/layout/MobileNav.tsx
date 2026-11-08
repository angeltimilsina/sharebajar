"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CandlestickChart, Home, Repeat, Wallet } from "lucide-react";
import clsx from "clsx";

const ITEMS = [
  { href: "/", label: "Market", Icon: Home },
  { href: "/discover", label: "Discover", Icon: BarChart3 },
  { href: "/trade", label: "Trade", Icon: Repeat },
  { href: "/charts", label: "Charts", Icon: CandlestickChart },
  { href: "/wallet", label: "Wallet", Icon: Wallet },
];

/** Thumb-reachable bottom navigation on phones (hidden from md up). */
export function MobileNav() {
  const path = usePathname();
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <nav aria-label="Primary" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] backdrop-blur-xl border-t border-line pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-5">
        {ITEMS.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link href={href} prefetch={false} aria-current={active(href) ? "page" : undefined}
              className={clsx("relative flex flex-col items-center justify-center gap-0.5 h-14 text-[10.5px] font-medium", active(href) ? "text-fg" : "text-muted")}>
              {active(href) && <span className="absolute top-0 h-[2px] w-8 rounded-full bg-accent" />}
              <Icon size={19} strokeWidth={active(href) ? 2.3 : 1.8} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

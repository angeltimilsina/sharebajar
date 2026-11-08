"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Home, PieChart, Repeat } from "lucide-react";
import { NAV } from "./Header";
import clsx from "clsx";

const ICONS: Record<string, typeof Home> = { "/": Home, "/discover": Compass, "/trade": Repeat, "/portfolio": PieChart };
const ITEMS = NAV.map((n) => ({ ...n, Icon: ICONS[n.href] }));

/** Thumb-reachable bottom navigation on phones (hidden from md up). */
export function MobileNav() {
  const path = usePathname();
  const active = (h: string) => ITEMS.find((i) => i.href === h)!.match.test(path);
  return (
    <nav aria-label="Primary" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] backdrop-blur-xl border-t border-line pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-4">
        {ITEMS.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link href={href} prefetch={false} aria-current={active(href) ? "page" : undefined}
              className={clsx("relative flex flex-col items-center justify-center gap-1 h-16 text-[11px] transition-colors", active(href) ? "text-fg font-medium" : "text-muted")}>
              <span className={clsx("grid place-items-center h-7 w-12 rounded-full transition-colors", active(href) && "bg-surface-3")}>
                <Icon size={19} strokeWidth={active(href) ? 2.2 : 1.7} />
              </span>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

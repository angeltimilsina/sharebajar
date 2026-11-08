"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Home, PieChart, Repeat } from "lucide-react";
import { NAV } from "./Header";
import clsx from "clsx";

const ICONS: Record<string, typeof Home> = { "/": Home, "/discover": Compass, "/trade": Repeat, "/portfolio": PieChart };
const ITEMS = NAV.map((n) => ({ ...n, Icon: ICONS[n.href] }));

/** Floating glass tab bar on phones (hidden from md up). */
export function MobileNav() {
  const path = usePathname();
  const active = (h: string) => ITEMS.find((i) => i.href === h)!.match.test(path);
  return (
    <nav aria-label="Primary" className="md:hidden fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pointer-events-none">
      <ul className="glass-capsule pointer-events-auto grid grid-cols-4 rounded-full p-1.5 max-w-md mx-auto">
        {ITEMS.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link href={href} prefetch={false} aria-current={active(href) ? "page" : undefined}
              className={clsx("relative flex flex-col items-center justify-center gap-0.5 h-[54px] rounded-full text-[10.5px] font-medium transition-colors", active(href) ? "text-brand bg-surface-3" : "text-fg/80")}>
              <Icon size={21} strokeWidth={active(href) ? 2.3 : 1.8} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

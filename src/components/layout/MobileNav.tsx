"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins, Rocket, ShoppingBag, Wallet } from "lucide-react";
import clsx from "clsx";
import { NAV } from "./Header";
import { sidebar, useSidebar } from "@/lib/ui/sidebar";
import { accountMenu } from "@/lib/ui/accountMenu";
import { useConnected } from "@/hooks/useConnected";

const ICONS: Record<string, typeof Coins> = { "/tokens": Coins, "/launchpad": Rocket, "/agents": ShoppingBag };
const ITEMS = NAV.map((n) => ({ ...n, Icon: ICONS[n.href] }));

/** Floating glass tab bar on phones (hidden from md up): Tokens, Launchpad, Agents, Wallet. */
export function MobileNav() {
  const path = usePathname();
  const { drawer } = useSidebar();
  const { connected } = useConnected();
  const walletPage = /^\/(portfolio|wallets?)(\/|$)/.test(path);
  const tab = (on: boolean) => clsx("relative w-full flex flex-col items-center justify-center gap-0.5 h-[54px] rounded-full text-[10.5px] font-medium transition-colors", on ? "text-brand bg-surface-3" : "text-fg/80");
  return (
    <nav aria-label="Primary" className="md:hidden fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pointer-events-none">
      <ul className="glass-capsule pointer-events-auto grid grid-cols-4 rounded-full p-1.5 max-w-sm mx-auto">
        {ITEMS.map(({ href, label, Icon, match }) => {
          const on = !drawer && match.test(path);
          return (
            <li key={href}>
              <Link href={href} prefetch={false} aria-current={on ? "page" : undefined} className={tab(on)}>
                <Icon size={21} strokeWidth={on ? 2.3 : 1.8} />
                {label}
              </Link>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={() => (connected ? accountMenu.toggle() : sidebar.setDrawer(!drawer))} aria-expanded={drawer} data-testid="mobile-wallet" className={tab(drawer || walletPage)}>
            <span className="relative">
              <Wallet size={21} strokeWidth={drawer || walletPage ? 2.3 : 1.8} />
              {connected && <span className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-accent ring-2 ring-[var(--surface)]" aria-hidden />}
            </span>
            Wallet
          </button>
        </li>
      </ul>
    </nav>
  );
}

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  Activity, Check, Crown, ChevronsLeft, ChevronsRight, Copy, Lock, LogOut, PieChart, Plug, RefreshCw, Repeat2, ShieldCheck, Wallet, X,
} from "lucide-react";
import { useConnected } from "@/hooks/useConnected";
import { useWallet } from "../wallet/WalletProvider";
import { lock } from "@/lib/bajar/session";
import { shortAddress } from "@/lib/format";
import { chainFromEvmId } from "@/lib/chains";
import { sidebar, useSidebar } from "@/lib/ui/sidebar";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/portfolio", label: "Portfolio", Icon: PieChart },
  { href: "/wallet", label: "Bajar Wallet", Icon: Wallet },
  { href: "/portfolio#activity", label: "Activity", Icon: Activity },
  { href: "/pro", label: "Profile & Pro", Icon: Crown },
];

/**
 * Everything about your wallet lives here: connect, sync, sign in, switch,
 * disconnect, and your wallet pages. A collapsible rail on desktop, a
 * slide-in drawer on phones.
 */
export function WalletSidebar() {
  const path = usePathname();
  const { drawer, collapsed } = useSidebar();
  // Render the rail's contents only on desktop, so phones have one copy (in the drawer).
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => { setDesktop(mq.matches); if (mq.matches) sidebar.setDrawer(false); };
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => { sidebar.setDrawer(false); }, [path]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") sidebar.setDrawer(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [drawer]);

  return (
    <>
      {/* Desktop rail */}
      <aside
        aria-label="Wallet"
        data-testid="wallet-sidebar"
        className={clsx("hidden lg:flex fixed left-0 top-16 bottom-0 z-30 flex-col border-r-[0.5px] border-line bg-[var(--bg)] transition-[width] duration-200", collapsed ? "w-[76px]" : "w-[260px]")}
      >
        {desktop !== false && <Body compact={collapsed} />}
        <div className={clsx("border-t-[0.5px] border-line p-2 flex items-center", collapsed ? "flex-col gap-1" : "justify-between")}>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => sidebar.setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand wallet panel" : "Collapse wallet panel"}
            data-testid="sidebar-collapse"
            className="h-10 w-10 grid place-items-center rounded-full text-muted hover:text-fg hover:bg-surface-2"
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </div>
      </aside>

      {/* Phone/tablet drawer */}
      <div className={clsx("lg:hidden fixed inset-0 z-[60]", drawer ? "" : "pointer-events-none")} aria-hidden={!drawer}>
        <div className={clsx("absolute inset-0 bg-black/40 transition-opacity", drawer ? "opacity-100" : "opacity-0")} onClick={() => sidebar.setDrawer(false)} />
        <aside
          aria-label="Wallet"
          role="dialog"
          aria-modal="true"
          data-testid="wallet-drawer"
          className={clsx("absolute left-0 top-0 bottom-0 w-[86vw] max-w-[320px] flex flex-col bg-[var(--bg)] border-r-[0.5px] border-line pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transition-transform duration-200", drawer ? "translate-x-0" : "-translate-x-full")}
        >
          <div className="h-14 px-4 flex items-center justify-between">
            <span className="font-display text-[21px] text-fg">Wallet</span>
            <button type="button" onClick={() => sidebar.setDrawer(false)} aria-label="Close wallet panel" className="h-10 w-10 grid place-items-center rounded-full text-muted hover:bg-surface-2"><X size={18} /></button>
          </div>
          {drawer && <Body compact={false} />}
          <div className="border-t-[0.5px] border-line p-3 flex items-center gap-2"><ThemeToggle /><span className="text-xs text-muted">Theme</span></div>
        </aside>
      </div>
    </>
  );
}

const rowCls = (compact: boolean) => clsx("w-full flex items-center rounded-xl text-[14.5px] text-muted hover:text-fg hover:bg-surface-2 transition-colors", compact ? "justify-center h-11" : "gap-2.5 px-3 py-2.5");

function Body({ compact }: { compact: boolean }) {
  const path = usePathname();
  const { wallet, bajarUnlocked } = useConnected();
  const { openModal, disconnect, session, signIn, signOut, error, sync, syncing } = useWallet();
  const [copied, setCopied] = useState(false);
  const [hash, setHash] = useState("");
  useEffect(() => {
    const h = () => setHash(window.location.hash);
    h();
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, [path]);
  const row = rowCls(compact);
  const label = (s: string) => (compact ? <span className="sr-only">{s}</span> : s);
  const chainName = wallet ? (wallet.chainType === "solana" ? "Solana" : chainFromEvmId(wallet.chainId ?? 0)?.name ?? `Chain ${wallet.chainId}`) : "";
  const signedIn = !!(wallet && session && session.address.toLowerCase() === wallet.address.toLowerCase());
  const isOn = (href: string) => {
    const [p, h] = href.split("#");
    return h ? path === p && hash === `#${h}` : path === p && !(p === "/portfolio" && hash === "#activity");
  };

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain p-2.5 space-y-3" data-testid="account-menu">
      {/* Status */}
      {wallet ? (
        <div className={clsx("rounded-2xl bg-surface", compact ? "p-2 grid place-items-center" : "p-3")}>
          {compact ? (
            <span className="relative h-9 w-9 rounded-full bg-surface-2 grid place-items-center" title={`${wallet.walletName} · ${shortAddress(wallet.address)}`}>
              <Wallet size={17} />
              <span className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-[var(--surface)]" />
            </span>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] num font-medium" data-testid="sidebar-address">{shortAddress(wallet.address)}</div>
                  <div className="text-xs text-faint truncate">{wallet.walletName} · {chainName}</div>
                </div>
                <button
                  type="button"
                  aria-label="Copy address"
                  onClick={() => { navigator.clipboard?.writeText(wallet.address); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
                  className="h-8 w-8 grid place-items-center rounded-full text-muted hover:text-fg hover:bg-surface-2"
                >
                  {copied ? <Check size={15} className="text-up" /> : <Copy size={15} />}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          data-testid="menu-connect"
          onClick={() => { sidebar.setDrawer(false); openModal(); }}
          title={compact ? "Connect wallet" : undefined}
          className={clsx("btn-ink w-full rounded-xl font-medium text-[14.5px] flex items-center justify-center gap-2", compact ? "h-11" : "h-11 px-3")}
        >
          <Plug size={16} />{label("Connect wallet")}
        </button>
      )}

      {/* Wallet actions */}
      {wallet && (
        <div className="space-y-0.5">
          <button type="button" className={row} onClick={() => sync()} disabled={syncing} data-testid="wallet-sync" title={compact ? "Sync wallet" : undefined}>
            <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />{label(syncing ? "Syncing…" : "Sync wallet")}
          </button>
          <button type="button" className={row} onClick={signedIn ? signOut : signIn} title={compact ? (signedIn ? "Sign out" : "Sign in with wallet") : undefined}>
            <ShieldCheck size={16} className={signedIn ? "text-up" : ""} />{label(signedIn ? "Signed in · Sign out" : "Sign in with wallet")}
          </button>
          <button type="button" className={row} data-testid="account-switch" title={compact ? "Switch wallet" : undefined} onClick={async () => { sidebar.setDrawer(false); await disconnect(); openModal(); }}>
            <Repeat2 size={16} />{label("Switch wallet")}
          </button>
          <button type="button" className={clsx(row, "!text-down")} data-testid="account-disconnect" title={compact ? "Disconnect" : undefined} onClick={() => { sidebar.setDrawer(false); disconnect(); }}>
            <LogOut size={16} />{label("Disconnect")}
          </button>
          {error && !compact && <div className="px-3 py-1 text-xs text-down">{error}</div>}
        </div>
      )}

      {/* Wallet pages */}
      <nav aria-label="Wallet pages" className="space-y-0.5">
        {!compact && <div className="px-3 pt-1 pb-1 text-[11px] uppercase tracking-wider text-faint">Your money</div>}
        {LINKS.filter((x) => wallet || bajarUnlocked || x.label !== "Activity").map(({ href, label: l, Icon }) => (
          <Link key={href} href={href} title={compact ? l : undefined} aria-current={isOn(href) ? "page" : undefined}
            className={clsx(row, isOn(href) && "!text-fg bg-surface-2 font-medium")}>
            <Icon size={16} />{label(l)}
            {href === "/wallet" && bajarUnlocked && !compact && <span className="ml-auto text-xs text-up">Unlocked</span>}
          </Link>
        ))}
        {bajarUnlocked && (
          <button type="button" className={row} title={compact ? "Lock Bajar Wallet" : undefined} onClick={() => lock()}>
            <Lock size={16} />{label("Lock Bajar Wallet")}
          </button>
        )}
      </nav>

      {!wallet && !compact && (
        <p className="px-3 text-[12px] leading-relaxed text-faint">Bajar never asks for your recovery phrase. You approve every transaction in your own wallet.</p>
      )}
    </div>
  );
}

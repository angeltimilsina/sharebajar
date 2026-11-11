"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Check, Copy, Crown, Lock, LogOut, PieChart, Plug, RefreshCw, Repeat2, ShieldCheck, ShoppingBag, UserRound, Wallet, X } from "lucide-react";
import { useConnected } from "@/hooks/useConnected";
import { useWallet } from "../wallet/WalletProvider";
import { useBajar } from "../bajar/useBajar";
import { lock } from "@/lib/bajar/session";
import { shortAddress } from "@/lib/format";
import { chainFromEvmId } from "@/lib/chains";
import { accountMenu, useAccountMenu } from "@/lib/ui/accountMenu";
import { ThemeToggle } from "./ThemeToggle";
import { MORE } from "./Header";

const row = "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[14.5px] text-muted hover:text-fg hover:bg-surface-2 transition-colors text-left";

/**
 * The header's Account button (in place of the old "…" menu): your wallet and
 * account controls, then the rest of Bajar. A dropdown on desktop, a sheet on phones.
 */
export function AccountButton() {
  const open = useAccountMenu();
  const path = usePathname();
  const { wallet, connected, session } = useConnected();
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => { const mq = window.matchMedia("(min-width: 640px)"); const on = () => setWide(mq.matches); on(); mq.addEventListener("change", on); return () => mq.removeEventListener("change", on); }, []);
  useEffect(() => { accountMenu.set(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (wide && !ref.current?.contains(e.target as Node)) accountMenu.set(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") accountMenu.set(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open, wide]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => accountMenu.toggle()} aria-expanded={open} aria-haspopup="dialog" aria-label="Account" data-testid="account-button"
        className={clsx("h-10 rounded-full inline-flex items-center gap-2 transition-colors", wallet || session ? "pl-1.5 pr-3 bg-surface-2 hover:bg-surface-3" : "w-10 justify-center text-muted hover:text-fg hover:bg-surface-2", open && "bg-surface-3 text-fg")}>
        <span className="relative h-7 w-7 rounded-full bg-surface grid place-items-center"><UserRound size={16} />{connected && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-[var(--surface-2)]" />}</span>
        {(wallet || session) && <span className="hidden sm:inline text-[13px] font-medium num">{shortAddress((wallet ?? session)!.address)}</span>}
      </button>
      {open && wide && (
        <div className="absolute z-[71] right-0 top-full mt-2 w-[340px] max-h-[80vh] overflow-y-auto rounded-[22px] bg-[var(--surface)] border-[0.5px] border-line shadow-2xl p-2.5 rise" role="dialog" aria-label="Account" data-testid="account-panel">
          <AccountPanel />
        </div>
      )}
      {/* Phones: a bottom sheet rendered at the page level, so it sits above the tab bar. */}
      {open && !wide && createPortal(
        <div className="fixed inset-0 z-[90]" data-testid="account-sheet">
          <div className="absolute inset-0 bg-black/45" onClick={() => accountMenu.set(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-[28px] bg-[var(--surface)] p-2.5 pb-[calc(env(safe-area-inset-bottom)+12px)] rise" role="dialog" aria-label="Account" data-testid="account-panel">
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-[17px] font-semibold">Account</span>
              <button onClick={() => accountMenu.set(false)} aria-label="Close" className="h-9 w-9 grid place-items-center rounded-full text-muted hover:bg-surface-2"><X size={17} /></button>
            </div>
            <AccountPanel />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function AccountPanel() {
  const { wallet, bajarUnlocked } = useConnected();
  const { hasVault } = useBajar();
  const { openModal, disconnect, session, signIn, signOut, error, sync, syncing } = useWallet();
  const [copied, setCopied] = useState(false);
  const close = () => accountMenu.set(false);
  const chainName = wallet ? (wallet.chainType === "solana" ? "Solana" : chainFromEvmId(wallet.chainId ?? 0)?.name ?? `Chain ${wallet.chainId}`) : "";
  const signedIn = !!(wallet && session && session.address.toLowerCase() === wallet.address.toLowerCase());

  return (
    <div className="space-y-2" data-testid="account-menu">
      {wallet ? (
        <div className="rounded-2xl bg-surface-2 p-3 flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] num font-medium" data-testid="account-address">{shortAddress(wallet.address)}</div>
            <div className="text-xs text-faint truncate">{wallet.walletName} · {chainName}</div>
          </div>
          <button type="button" aria-label="Copy address" onClick={() => { navigator.clipboard?.writeText(wallet.address); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="h-8 w-8 grid place-items-center rounded-full text-muted hover:text-fg hover:bg-surface-3">
            {copied ? <Check size={15} className="text-up" /> : <Copy size={15} />}
          </button>
        </div>
      ) : session ? (
        <div className="rounded-2xl bg-surface-2 p-3 space-y-2" data-testid="account-session">
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={16} className="text-up shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] num font-medium" data-testid="account-address">{shortAddress(session.address)}</div>
              <div className="text-xs text-faint">Signed in · reconnect your wallet to sign or pay</div>
            </div>
          </div>
          <button type="button" data-testid="account-reconnect" onClick={() => { close(); openModal(); }} className="btn-ink w-full h-10 rounded-xl font-medium text-[14px] flex items-center justify-center gap-2"><Plug size={15} /> Reconnect wallet</button>
          <button type="button" className={row} onClick={signOut}><LogOut size={16} />Sign out</button>
        </div>
      ) : (
        <button type="button" data-testid="account-connect" onClick={() => { close(); openModal(); }} className="btn-ink w-full h-11 rounded-xl font-medium text-[14.5px] flex items-center justify-center gap-2"><Plug size={16} /> Connect wallet</button>
      )}

      {wallet && (
        <div className="space-y-0.5">
          <button type="button" className={row} onClick={() => sync()} disabled={syncing} data-testid="wallet-sync"><RefreshCw size={16} className={syncing ? "animate-spin" : ""} />{syncing ? "Syncing…" : "Sync wallet"}</button>
          <button type="button" className={row} onClick={signedIn ? signOut : signIn}><ShieldCheck size={16} className={signedIn ? "text-up" : ""} />{signedIn ? "Signed in · Sign out" : "Sign in with wallet"}</button>
          <button type="button" className={row} data-testid="account-switch" onClick={async () => { close(); await disconnect(); openModal(); }}><Repeat2 size={16} />Switch wallet</button>
          <button type="button" className={clsx(row, "!text-down")} data-testid="account-disconnect" onClick={() => { close(); disconnect(); }}><LogOut size={16} />Disconnect</button>
          {error && <div className="px-3 py-1 text-xs text-down">{error}</div>}
        </div>
      )}

      <div className="space-y-0.5 border-t border-line pt-2">
        {(wallet || bajarUnlocked) && <Link href="/portfolio" className={row} onClick={close}><PieChart size={16} />Portfolio</Link>}
        <Link href="/wallet" className={row} onClick={close}><Wallet size={16} />Bajar Wallet{bajarUnlocked && <span className="ml-auto text-xs text-up">Unlocked</span>}</Link>
        {hasVault && !bajarUnlocked && <Link href="/wallet" className={clsx(row, "!text-warn")} onClick={close} data-testid="bajar-locked"><Lock size={16} />Bajar Wallet locked · Unlock</Link>}
        {bajarUnlocked && <button type="button" className={row} onClick={() => { close(); lock(); }}><Lock size={16} />Lock Bajar Wallet</button>}
        <Link href="/pro" className={row} onClick={close}><Crown size={16} />Profile & Pro</Link>
        <Link href="/agents/profile" className={row} onClick={close} data-testid="account-shopping-profile"><ShoppingBag size={16} />Shopping profile & store logins</Link>
      </div>

      <nav aria-label="More pages" className="space-y-0.5 border-t border-line pt-2" data-testid="account-pages">
        <div className="px-3 pb-1 text-[11px] uppercase tracking-wider text-faint">Explore</div>
        {MORE.filter((m) => m.href !== "/pro").map((m) => (
          <Link key={m.href} href={m.href} onClick={close} role="menuitem" className="block px-3 py-2 rounded-xl hover:bg-surface-2">
            <span className="text-[14.5px] font-medium">{m.label}{m.ai && <span className="ml-2 rounded-full bg-ai/15 text-ai text-[10px] font-semibold px-1.5 py-0.5">AI</span>}</span>
            <span className="block text-xs text-faint">{m.hint}</span>
          </Link>
        ))}
      </nav>
      <div className="border-t border-line pt-2 px-1 flex items-center gap-2"><ThemeToggle /><span className="text-xs text-muted">Theme</span></div>
    </div>
  );
}

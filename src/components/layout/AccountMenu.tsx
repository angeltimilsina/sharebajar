"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Lock, LogOut, PieChart, Plug, Repeat2, ShieldCheck, Wallet } from "lucide-react";
import { useConnected } from "@/hooks/useConnected";
import { useWallet } from "../wallet/WalletProvider";
import { lock } from "@/lib/bajar/session";
import { shortAddress } from "@/lib/format";
import { chainFromEvmId } from "@/lib/chains";

const row = "w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-[15px] text-muted hover:text-fg hover:bg-surface-2";

/** Wallet settings inside the menu: connect, or who's connected, switch, sign in, disconnect. */
export function AccountMenu({ onDone }: { onDone: () => void }) {
  const { wallet, bajarUnlocked } = useConnected();
  const { openModal, disconnect, session, signIn, signOut, error } = useWallet();
  const [copied, setCopied] = useState(false);
  if (!wallet && !bajarUnlocked) {
    return (
      <div data-testid="account-menu">
        <div className="px-3.5 pt-3 pb-1 text-[11px] uppercase tracking-wider text-faint">Wallet</div>
        <button className={row} data-testid="menu-connect" onClick={() => { onDone(); openModal(); }}><Plug size={16} /> Connect wallet</button>
      </div>
    );
  }
  const chainName = wallet ? (wallet.chainType === "solana" ? "Solana" : chainFromEvmId(wallet.chainId ?? 0)?.name ?? `Chain ${wallet.chainId}`) : "";
  const signedIn = wallet && session && session.address.toLowerCase() === wallet.address.toLowerCase();
  return (
    <div data-testid="account-menu">
      <div className="px-3.5 pt-3 pb-1 text-[11px] uppercase tracking-wider text-faint">Wallet</div>
      {wallet && (
        <>
          <div className="px-3.5 py-2 flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
            <div className="min-w-0">
              <div className="text-[15px] num">{shortAddress(wallet.address)}</div>
              <div className="text-xs text-faint">{wallet.walletName} · {chainName}</div>
            </div>
          </div>
          <button className={row} onClick={() => { navigator.clipboard?.writeText(wallet.address); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            {copied ? <Check size={16} className="text-up" /> : <Copy size={16} />} Copy address
          </button>
          <Link href="/portfolio" onClick={onDone} className={row}><PieChart size={16} /> Portfolio</Link>
          <button className={row} onClick={signedIn ? signOut : signIn}><ShieldCheck size={16} className={signedIn ? "text-up" : ""} />{signedIn ? "Signed in · Sign out" : "Sign in with wallet"}</button>
          <button className={row} data-testid="account-switch" onClick={async () => { onDone(); await disconnect(); openModal(); }}><Repeat2 size={16} /> Switch wallet</button>
          <button className={`${row} !text-down`} data-testid="account-disconnect" onClick={() => { onDone(); disconnect(); }}><LogOut size={16} /> Disconnect</button>
          {error && <div className="px-3.5 py-1 text-xs text-down">{error}</div>}
        </>
      )}
      {bajarUnlocked && (
        <>
          <Link href="/wallet" onClick={onDone} className={row}><Wallet size={16} /> Bajar Wallet <span className="ml-auto text-xs text-up">Unlocked</span></Link>
          <button className={row} onClick={() => { onDone(); lock(); }}><Lock size={16} /> Lock Bajar Wallet</button>
        </>
      )}
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Wallet, LogOut, Copy, ShieldCheck, Check, PieChart } from "lucide-react";
import { useWallet } from "./WalletProvider";
import { Button } from "../ui/primitives";
import { shortAddress } from "@/lib/format";
import { chainFromEvmId } from "@/lib/chains";

export function ConnectButton({ compact }: { compact?: boolean }) {
  const { wallet, openModal, disconnect, session, signIn, signOut, error } = useWallet();
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (!wallet) {
    return (
      <Button onClick={openModal} className={compact ? "h-9 rounded-full px-3.5 text-[13px]" : "h-10 rounded-full px-4"} aria-label="Connect wallet">
        <Wallet size={15} /><span className="whitespace-nowrap">{compact ? "Connect" : "Connect wallet"}</span>
      </Button>
    );
  }
  const signedIn = session && session.address.toLowerCase() === wallet.address.toLowerCase();
  const chainName = wallet.chainType === "solana" ? "Solana" : chainFromEvmId(wallet.chainId ?? 0)?.name ?? `Chain ${wallet.chainId}`;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setMenu((m) => !m)} className="h-10 flex items-center gap-2 rounded-full bg-surface-2 hover:bg-surface-3 px-3.5 text-sm font-medium">
        <span className="h-2 w-2 rounded-full bg-accent" />
        <span className="num">{shortAddress(wallet.address)}</span>
      </button>
      {menu && (
        <div className="absolute right-0 mt-2 w-64 panel glass p-2 z-50 text-sm">
          <div className="px-2.5 py-2">
            <div className="text-[11px] text-muted">{wallet.walletName} · {chainName}</div>
            <div className="num text-xs mt-0.5 break-all">{wallet.address}</div>
          </div>
          <button className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-3" onClick={() => { navigator.clipboard?.writeText(wallet.address); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            {copied ? <Check size={14} className="text-up" /> : <Copy size={14} />} Copy address
          </button>
          <Link href="/portfolio" onClick={() => setMenu(false)} className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-3"><PieChart size={14} /> Portfolio</Link>
          {signedIn ? (
            <button className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-3" onClick={signOut}><ShieldCheck size={14} className="text-up" /> Signed in · Sign out</button>
          ) : (
            <button className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-3" onClick={signIn}><ShieldCheck size={14} /> Sign in with wallet</button>
          )}
          {error && <div className="px-2.5 py-1 text-[11px] text-down">{error}</div>}
          <button className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-3 text-down" onClick={() => { setMenu(false); disconnect(); }}><LogOut size={14} /> Disconnect</button>
        </div>
      )}
    </div>
  );
}

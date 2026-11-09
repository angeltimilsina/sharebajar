"use client";
import Link from "next/link";
import { ChevronRight, Rocket, Wallet } from "lucide-react";
import { useConnected } from "@/hooks/useConnected";
import { useWallet } from "../wallet/WalletProvider";

/** Trade page companions: connect (until connected) and launch your own token. */
export function TradeSideCards() {
  const { connected } = useConnected();
  const { openModal } = useWallet();
  return (
    <div className="space-y-3" data-testid="trade-side">
      {!connected && (
        <div className="panel p-5">
          <div className="flex items-start gap-3.5">
            <span className="h-9 w-9 shrink-0 rounded-[10px] grid place-items-center text-white bg-[#0a84ff]"><Wallet size={19} strokeWidth={2.2} /></span>
            <div className="min-w-0">
              <h2 className="text-[17px]">Connect a wallet to trade</h2>
              <p className="text-[13.5px] text-muted mt-1 leading-relaxed">Quotes work without one. You only connect to approve a trade — Bajar never holds your funds or keys.</p>
            </div>
          </div>
          <button onClick={openModal} className="btn-ink mt-4 w-full h-11 rounded-full text-[15px] font-semibold" data-testid="trade-connect">Connect wallet</button>
          <Link href="/wallet" className="mt-2 block text-center text-[13.5px] text-brand">or create a Bajar Wallet</Link>
        </div>
      )}
      <Link href="/launchpad#create" className="panel p-5 flex items-center gap-3.5 hover:bg-surface-2/60 active:scale-[0.99] transition relative overflow-hidden" data-testid="trade-launch">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-25 blur-2xl" style={{ background: "radial-gradient(circle, #ff375f, transparent 70%)" }} aria-hidden />
        <span className="h-9 w-9 shrink-0 rounded-[10px] grid place-items-center text-white bg-[#ff375f]"><Rocket size={19} strokeWidth={2.2} /></span>
        <div className="min-w-0 flex-1 relative">
          <h2 className="text-[17px]">Launch your own token</h2>
          <p className="text-[13.5px] text-muted mt-0.5 leading-snug">Create a Solana token with name, logo and supply in one transaction you sign.</p>
        </div>
        <ChevronRight size={18} className="text-faint shrink-0" />
      </Link>
    </div>
  );
}

"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { Loader2, Sparkles } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import type { TrackedWallet } from "@/lib/wallets/registry";
import { bajar } from "@/lib/bajar/session";
import { buildAgentPortfolio, stashAgentPortfolio } from "@/lib/wallets/agent";
import { fetchBalances } from "@/hooks/useWallets";

/**
 * Opens the investment agent with a summary of the Portfolio wallet:
 * assets, values and allocation only, never addresses.
 */
export function AgentButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const router = useRouter();
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  const on = path === "/intelligence";
  const { wallet } = useWallet();
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Same wallet as Portfolio: Bajar Wallet (+ wallets connected to it), else the connected wallet.
      const a = bajar.isUnlocked() ? bajar.accounts() : null;
      let wallets: TrackedWallet[] = [];
      if (a) {
        wallets = [
          { id: `bitcoin:${a.bitcoin.address}`, address: a.bitcoin.address, chain: "bitcoin", label: "Bajar Wallet", source: "bajar", addedAt: 0 },
          { id: `evm:${a.evm.address.toLowerCase()}`, address: a.evm.address, chain: "evm", label: "Bajar Wallet", source: "bajar", addedAt: 0 },
          { id: `solana:${a.solana.address}`, address: a.solana.address, chain: "solana", label: "Bajar Wallet", source: "bajar", addedAt: 0 },
        ];
        const prof = await fetch("/api/profile", { cache: "no-store" }).then((r) => r.json()).catch(() => null) as { address?: string; profile?: { wallets: { address: string; chainType: "solana" | "evm" }[] } } | null;
        if (prof?.address === a.solana.address) for (const w of prof.profile?.wallets ?? []) if (!wallets.some((x) => x.address.toLowerCase() === w.address.toLowerCase())) wallets.push({ id: `${w.chainType}:${w.address}`, address: w.address, chain: w.chainType, label: "Connected", source: "linked", addedAt: 1 });
      } else if (wallet) {
        wallets = [{ id: `${wallet.chainType}:${wallet.address}`, address: wallet.address, chain: wallet.chainType, label: wallet.walletName, source: "connected", addedAt: 0 }];
      }
      if (wallets.length) stashAgentPortfolio(buildAgentPortfolio(await fetchBalances(wallets)));
    } catch { /* agent still opens; it asks for holdings instead */ }
    setBusy(false);
    router.push("/intelligence?agent=portfolio");
  };
  return (
    <button type="button" onClick={open} data-testid="open-agent" title={compact ? "Investment agent" : undefined} aria-current={on ? "page" : undefined}
      className={clsx(className, "w-full flex items-center rounded-2xl text-white font-semibold text-[14px] transition-opacity hover:opacity-95", compact ? "justify-center h-11" : "gap-2.5 px-3 py-2.5")}
      style={{ background: "linear-gradient(135deg,#bf5af2,#0a84ff)" }}>
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
      {compact ? <span className="sr-only">Investment agent</span> : <span className="flex-1 text-left">Investment agent<span className="block text-[11.5px] font-normal opacity-85">Ideas for your portfolio</span></span>}
    </button>
  );
}

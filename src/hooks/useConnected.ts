"use client";
import { useWallet } from "@/components/wallet/WalletProvider";
import { useBajar } from "@/components/bajar/useBajar";

/** True once the user has a wallet connected (any provider) or the Bajar Wallet unlocked. */
export function useConnected() {
  const { wallet } = useWallet();
  const { unlocked } = useBajar();
  return { connected: !!wallet || unlocked, wallet, bajarUnlocked: unlocked };
}

"use client";
import { useWallet } from "@/components/wallet/WalletProvider";
import { useBajar } from "@/components/bajar/useBajar";

/**
 * True once the user has a wallet connected (any provider), the Bajar Wallet
 * unlocked, or a valid sign-in session (kept across pages and visits even
 * while the wallet itself needs reconnecting to sign).
 */
export function useConnected() {
  const { wallet, session, restoring } = useWallet();
  const { unlocked } = useBajar();
  return { connected: !!wallet || unlocked || !!session, wallet, bajarUnlocked: unlocked, session, restoring, signedInOnly: !wallet && !unlocked && !!session };
}

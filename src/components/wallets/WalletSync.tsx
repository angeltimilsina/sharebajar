"use client";
import { useEffect } from "react";
import { useWallet } from "../wallet/WalletProvider";
import { useBajar } from "../bajar/useBajar";
import { registry } from "@/lib/wallets/registry";
import { useProfile } from "@/hooks/useProfile";

/** Keeps the wallet registry up to date with whatever is connected or unlocked. */
export function WalletSync() {
  const { wallet } = useWallet();
  const { unlocked, accounts } = useBajar();
  const { profile } = useProfile();
  // Wallets proven on the signed-in profile follow you to every device.
  useEffect(() => {
    for (const w of profile?.wallets ?? []) registry.upsert({ address: w.address, chain: w.chainType, label: w.label && w.label !== "Sign-in wallet" ? w.label : `${w.chainType === "evm" ? "EVM" : "Solana"} ${w.address.slice(0, 4)}…${w.address.slice(-4)}`, source: "linked", verified: true });
  }, [profile]);
  useEffect(() => {
    if (!wallet) return;
    registry.upsert({ address: wallet.address, chain: wallet.chainType === "solana" ? "solana" : "evm", label: wallet.walletName, source: "connected", walletId: wallet.walletId });
  }, [wallet]);
  useEffect(() => {
    if (!unlocked || !accounts) return;
    registry.upsert({ address: accounts.bitcoin.address, chain: "bitcoin", label: "Bajar · Bitcoin", source: "bajar", walletId: "bajar" });
    registry.upsert({ address: accounts.evm.address, chain: "evm", label: "Bajar · EVM", source: "bajar", walletId: "bajar.evm" });
    registry.upsert({ address: accounts.solana.address, chain: "solana", label: "Bajar · Solana", source: "bajar", walletId: "bajar" });
  }, [unlocked, accounts]);
  return null;
}

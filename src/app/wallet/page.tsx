import type { Metadata } from "next";
import { WalletApp } from "@/components/bajar/WalletApp";

export const metadata: Metadata = { title: "BAJAR Wallet", description: "Noncustodial multi-chain wallet for Bitcoin, Ethereum/EVM and Solana.", robots: { index: false } };

export default function WalletPage() {
  return <WalletApp />;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { TokenMarketplace } from "@/components/tokens/TokenMarketplace";

export const metadata: Metadata = {
  title: "Tokens — trending Solana, Base & EVM launches",
  description: "A live token marketplace: trending launches on Solana, Base, Ethereum and BNB Chain, newly created pools, the best performing tokens and the deepest liquidity pools.",
  alternates: { canonical: "/tokens" },
};

export default function TokensPage() {
  return <Suspense><TokenMarketplace /></Suspense>;
}

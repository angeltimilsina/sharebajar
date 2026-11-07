import type { Metadata } from "next";
import { Suspense } from "react";
import { Discover } from "@/components/discover/Discover";

export const metadata: Metadata = { title: "Token Discovery — trending, new & high-volume pools", description: "Real-time multi-chain token discovery: trending and newly created liquidity pools on Solana, Ethereum, Base, BNB Chain, Polygon and Arbitrum." };

export default function DiscoverPage() {
  return <Suspense><Discover /></Suspense>;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { Launchpad } from "@/components/discover/Launchpad";

export const metadata: Metadata = { title: "Launchpad — newly launched tokens & pools", description: "Track new liquidity pools and token launches across Solana, Ethereum, Base, BNB Chain and more in real time." };

export default function LaunchpadPage() {
  return <Suspense><Launchpad /></Suspense>;
}

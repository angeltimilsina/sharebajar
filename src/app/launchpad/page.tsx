import type { Metadata } from "next";
import { Suspense } from "react";
import { Launchpad } from "@/components/discover/Launchpad";

export const metadata: Metadata = { title: "Launchpad — create a Solana token & track new launches", description: "Create a Solana SPL token with metadata from your own wallet (fixed supply, no freeze authority) and track new liquidity pools across Solana, Ethereum, Base and BNB Chain in real time.", alternates: { canonical: "/launchpad" } };

export default function LaunchpadPage() {
  return <Suspense><Launchpad /></Suspense>;
}

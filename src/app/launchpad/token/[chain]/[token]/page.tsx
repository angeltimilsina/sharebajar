import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TokenManager } from "@/components/launch/TokenManager";

export const metadata: Metadata = { title: "Token manager", robots: { index: false } };

export default async function TokenManagerPage({ params }: { params: Promise<{ chain: string; token: string }> }) {
  const { chain, token } = await params;
  if (!["solana", "ethereum", "base", "bsc"].includes(chain) || !(chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/).test(token)) notFound();
  return <TokenManager chain={chain} token={token} />;
}

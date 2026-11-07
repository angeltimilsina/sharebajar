import type { Metadata } from "next";
import { Suspense } from "react";
import { TradeView } from "@/components/trade/TradeView";

export const metadata: Metadata = { title: "Trade — swap tokens with live charts & order books", description: "Swap Solana tokens with best-route quotes, live charts, order books and transaction simulation. Non-custodial." };

export default function TradePage() {
  return <Suspense><TradeView /></Suspense>;
}

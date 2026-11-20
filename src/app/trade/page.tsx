import type { Metadata } from "next";
import { Suspense } from "react";
import { TradeView } from "@/components/trade/TradeView";

export const metadata: Metadata = { title: "Trade — buy, sell and swap with live charts", description: "One trading workspace: live charts, order books and liquidity, with market buys, sells and best-route swaps on Solana and EVM networks from your own wallet." };

export default function TradePage() {
  return <><span data-app-page hidden /><Suspense><TradeView /></Suspense></>;
}

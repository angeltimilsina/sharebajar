import type { Metadata } from "next";
import { Suspense } from "react";
import { ChartsView } from "@/components/chart/ChartsView";

export const metadata: Metadata = { title: "Pro Charts — 1-second candles, indicators & drawing tools", description: "Professional real-time crypto charts with 1s–1w timeframes, RSI, MACD, VWAP, Bollinger Bands, volume profile and Bajar indicators." };

export default function ChartsPage() {
  return <Suspense><ChartsView /></Suspense>;
}

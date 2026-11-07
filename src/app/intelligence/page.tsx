import type { Metadata } from "next";
import { Chat } from "@/components/ai/Chat";
import { SignalsFeed } from "@/components/ai/SignalsFeed";
import { MarketNews } from "@/components/market/SideFeeds";

export const metadata: Metadata = { title: "ShareBajar Intelligence — AI market analysis", description: "AI-powered crypto market intelligence grounded in live prices, on-chain activity, contract security and news." };

export default function IntelligencePage() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Chat />
      <div className="space-y-4">
        <SignalsFeed />
        <div id="news"><MarketNews limit={8} /></div>
      </div>
    </div>
  );
}

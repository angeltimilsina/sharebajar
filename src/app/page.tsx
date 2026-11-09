import { MarketBoard } from "@/components/market/MarketBoard";
import { getMarkets } from "@/lib/market/markets";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const coins = await getMarkets({ perPage: 100 }).catch(() => null);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[28px] sm:text-[34px] leading-tight">Markets</h1>
        <p className="text-muted text-[14.5px] mt-1">Live prices across every major network. Switch the view, the network or the stat you care about.</p>
      </div>
      <MarketBoard initialCoins={coins} />
    </div>
  );
}

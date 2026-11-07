import { Hero } from "@/components/market/Hero";
import { StatCards, type Overview } from "@/components/market/StatCards";
import { HomeMarkets } from "@/components/market/HomeMarkets";
import { NetworkPulse } from "@/components/market/NetworkPulse";
import { getGlobal, getMarkets } from "@/lib/market/markets";
import { getDefiTvl } from "@/lib/market/defillama";
import { errorMessage } from "@/lib/server/cache";

export const dynamic = "force-dynamic";

async function loadInitial() {
  const [g, t, m] = await Promise.allSettled([getGlobal(), getDefiTvl(), getMarkets({ perPage: 100 })]);
  const overview: Overview = {
    global: g.status === "fulfilled" ? g.value : { error: errorMessage(g.reason) },
    tvl: t.status === "fulfilled" ? t.value : { error: errorMessage(t.reason) },
  };
  return { overview, coins: m.status === "fulfilled" ? m.value : null };
}

export default async function HomePage() {
  const { overview, coins } = await loadInitial();
  return (
    <div className="space-y-4">
      <Hero />
      <StatCards initial={overview} />
      <NetworkPulse />
      <HomeMarkets initialCoins={coins} />
    </div>
  );
}

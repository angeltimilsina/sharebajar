import { getGlobal } from "@/lib/market/coingecko";
import { getDefiTvl } from "@/lib/market/defillama";
import { errorMessage } from "@/lib/server/cache";
import { NextResponse } from "next/server";

export async function GET() {
  const [g, t] = await Promise.allSettled([getGlobal(), getDefiTvl()]);
  return NextResponse.json(
    {
      global: g.status === "fulfilled" ? g.value : { error: errorMessage(g.reason) },
      tvl: t.status === "fulfilled" ? t.value : { error: errorMessage(t.reason) },
    },
    { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } },
  );
}

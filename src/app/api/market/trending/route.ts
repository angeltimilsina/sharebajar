import { getTrendingCoins } from "@/lib/market/coingecko";
import { fail, ok } from "@/lib/server/respond";

export async function GET() {
  try {
    return ok(await getTrendingCoins(), 120);
  } catch (e) {
    return fail(e, "CoinGecko");
  }
}

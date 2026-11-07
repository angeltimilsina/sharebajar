import { getMarkets } from "@/lib/market/coingecko";
import { getChain } from "@/lib/chains";
import { fail, ok } from "@/lib/server/respond";

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const chain = getChain(url.searchParams.get("network"));
    const order = url.searchParams.get("order") === "volume_desc" ? "volume_desc" : "market_cap_desc";
    const page = Math.max(1, Math.min(10, Number(url.searchParams.get("page") ?? 1) || 1));
    const ids = url.searchParams.get("ids")?.split(",").filter((s) => /^[a-z0-9-]+$/.test(s)).slice(0, 100);
    return ok(await getMarkets({ category: chain?.coingeckoCategory, order, page, perPage: 100, ids }), 30);
  } catch (e) {
    return fail(e, "CoinGecko");
  }
}

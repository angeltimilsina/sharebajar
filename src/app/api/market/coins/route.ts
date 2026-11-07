import { getMarkets } from "@/lib/market/markets";
import { fail, ok } from "@/lib/server/respond";

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const order = url.searchParams.get("order") === "volume_desc" ? "volume_desc" : "market_cap_desc";
    const perPage = Math.max(10, Math.min(250, Number(url.searchParams.get("limit") ?? 100) || 100));
    const ids = url.searchParams.get("ids")?.split(",").filter((s) => /^[a-z0-9-]+$/.test(s)).slice(0, 100);
    return ok(await getMarkets({ order, perPage, ids }), 15);
  } catch (e) {
    return fail(e, "CoinLore");
  }
}

import { getCoinChart } from "@/lib/market/coingecko";
import { fail, ok, param } from "@/lib/server/respond";

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    return ok(await getCoinChart(param(url, "id"), url.searchParams.get("days") ?? "1"), 60);
  } catch (e) {
    return fail(e, "CoinGecko");
  }
}

import { getCoin } from "@/lib/market/coingecko";
import { fail, ok, param } from "@/lib/server/respond";

export async function GET(req: Request) {
  try {
    const id = param(new URL(req.url), "id");
    return ok(await getCoin(id), 30);
  } catch (e) {
    return fail(e, "CoinGecko");
  }
}

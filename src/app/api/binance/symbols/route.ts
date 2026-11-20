import { getUsdtSymbols } from "@/lib/market/binance";
import { fail, ok } from "@/lib/server/respond";

/** Base asset → Binance USDT symbol map, used to attach live streams. */
export async function GET() {
  try {
    return ok(await getUsdtSymbols(), 3600);
  } catch (e) {
    return fail(e, "Binance");
  }
}

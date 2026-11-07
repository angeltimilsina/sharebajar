import { getKlines, SYMBOL_RE, type BinanceInterval } from "@/lib/market/binance";
import { aggregateCandles, RESOLUTION_SECONDS } from "@/lib/analytics/candles";
import { BadRequest, fail, ok, param } from "@/lib/server/respond";

const DIRECT: Record<string, BinanceInterval> = { "1s": "1s", "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w" };

/** Binance OHLCV history. 5s/15s are aggregated from real 1s klines. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const symbol = param(url, "symbol").toUpperCase();
    const res = param(url, "res", "1m");
    if (!SYMBOL_RE.test(symbol)) throw new BadRequest("Invalid symbol");
    const sec = RESOLUTION_SECONDS[res];
    if (!sec) throw new BadRequest("Unsupported resolution");
    if (res === "5s" || res === "15s") {
      const env = await getKlines(symbol, "1s", 1000);
      return ok({ ...env, data: aggregateCandles(env.data, sec) }, 1);
    }
    // Raw 1s history, optionally several pages back (clients aggregate 5s/15s live).
    if (res === "1s") {
      const pages = Math.min(3, Math.max(1, Number(url.searchParams.get("pages") ?? 1) || 1));
      let env = await getKlines(symbol, "1s", 1000);
      let data = env.data;
      for (let i = 1; i < pages && data.length; i++) {
        const older = await getKlines(symbol, "1s", 1000, data[0].time * 1000 - 1);
        data = [...older.data, ...data];
        env = { ...env, stale: env.stale || older.stale };
      }
      return ok({ ...env, data }, 1);
    }
    const interval = DIRECT[res];
    return ok(await getKlines(symbol, interval, 600), 5);
  } catch (e) {
    return fail(e, "Binance");
  }
}

import { getPoolOhlcv, gtResolution } from "@/lib/market/geckoterminal";
import { addressParam, chainParam } from "@/lib/server/chain-param";
import { BadRequest, fail, ok } from "@/lib/server/respond";

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const chain = chainParam(url);
    const pool = addressParam(url, chain, "pool");
    const r = gtResolution(url.searchParams.get("res") ?? "1m");
    if (!r) throw new BadRequest("Unsupported resolution for DEX history (sub-minute candles are built from live trades)");
    return ok(await getPoolOhlcv(chain.geckoterminal, pool, r.timeframe, r.aggregate), 15);
  } catch (e) {
    return fail(e, "GeckoTerminal");
  }
}

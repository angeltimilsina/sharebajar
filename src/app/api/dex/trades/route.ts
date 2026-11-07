import { getPoolTrades } from "@/lib/market/geckoterminal";
import { addressParam, chainParam } from "@/lib/server/chain-param";
import { fail, ok } from "@/lib/server/respond";

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const chain = chainParam(url);
    return ok(await getPoolTrades(chain.geckoterminal, addressParam(url, chain, "pool")), 2);
  } catch (e) {
    return fail(e, "GeckoTerminal");
  }
}

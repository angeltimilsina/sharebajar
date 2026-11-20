import { getTokenPairs } from "@/lib/market/dexscreener";
import { addressParam, chainParam } from "@/lib/server/chain-param";
import { fail, ok } from "@/lib/server/respond";

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const chain = chainParam(url);
    return ok(await getTokenPairs(chain.dexscreener, addressParam(url, chain)), 10);
  } catch (e) {
    return fail(e, "DexScreener");
  }
}

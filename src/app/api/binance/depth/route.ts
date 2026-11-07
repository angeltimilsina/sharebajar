import { getDepth, SYMBOL_RE } from "@/lib/market/binance";
import { BadRequest, fail, ok, param } from "@/lib/server/respond";

export async function GET(req: Request) {
  try {
    const symbol = param(new URL(req.url), "symbol").toUpperCase();
    if (!SYMBOL_RE.test(symbol)) throw new BadRequest("Invalid symbol");
    return ok(await getDepth(symbol, 20), 1);
  } catch (e) {
    return fail(e, "Binance");
  }
}

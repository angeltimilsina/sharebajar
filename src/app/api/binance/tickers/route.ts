import { get24hTickers, SYMBOL_RE } from "@/lib/market/binance";
import { BadRequest, fail, ok, param } from "@/lib/server/respond";

export async function GET(req: Request) {
  try {
    const symbols = param(new URL(req.url), "symbols").toUpperCase().split(",").filter((s) => SYMBOL_RE.test(s)).slice(0, 30);
    if (!symbols.length) throw new BadRequest("No valid symbols");
    return ok(await get24hTickers(symbols), 5);
  } catch (e) {
    return fail(e, "Binance");
  }
}

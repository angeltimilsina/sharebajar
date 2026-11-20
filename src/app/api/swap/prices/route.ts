import { getPrices } from "@/lib/trading/jupiter";
import { BadRequest, fail, ok, param } from "@/lib/server/respond";

export async function GET(req: Request) {
  try {
    const ids = param(new URL(req.url), "ids").split(",").filter((s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s));
    if (!ids.length) throw new BadRequest("No valid mints");
    return ok(await getPrices(ids), 10);
  } catch (e) {
    return fail(e, "Jupiter");
  }
}

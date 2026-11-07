import { searchTokens } from "@/lib/trading/jupiter";
import { fail, ok, param } from "@/lib/server/respond";

export async function GET(req: Request) {
  try {
    return ok(await searchTokens(param(new URL(req.url), "q")), 60);
  } catch (e) {
    return fail(e, "Jupiter");
  }
}

import { getTokenSecurity } from "@/lib/security/goplus";
import { addressParam, chainParam } from "@/lib/server/chain-param";
import { fail, ok } from "@/lib/server/respond";

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const chain = chainParam(url);
    return ok(await getTokenSecurity(chain, addressParam(url, chain)), 300);
  } catch (e) {
    return fail(e, "GoPlus");
  }
}

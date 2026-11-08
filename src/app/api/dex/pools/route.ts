import { getNewPools, getTopPools, getTrendingPools } from "@/lib/market/geckoterminal";
import { getChain } from "@/lib/chains";
import { fail, ok } from "@/lib/server/respond";

/** feed=trending|new|top, network=<chain slug> (optional for trending/new) */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const feed = url.searchParams.get("feed") ?? "trending";
    const chain = getChain(url.searchParams.get("network"));
    const net = chain?.geckoterminal;
    const duration = (["5m", "1h", "6h", "24h"].includes(url.searchParams.get("duration") ?? "") ? url.searchParams.get("duration") : "24h") as "5m" | "1h" | "6h" | "24h";
    // Only keep networks Bajar supports (token pages exist for them).
    const supported = <T extends { data: { network: string }[] }>(env: T): T => ({ ...env, data: env.data.filter((p) => getChain(p.network)) });
    if (feed === "new") return ok(supported(await getNewPools(net)), 15);
    if (feed === "top") return ok(supported(await getTopPools(net ?? "solana")), 30);
    return ok(supported(await getTrendingPools(net, duration)), 30);
  } catch (e) {
    return fail(e, "GeckoTerminal");
  }
}

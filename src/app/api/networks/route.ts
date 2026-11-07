import { getNetworkStats } from "@/lib/market/networks";
import { fail, ok } from "@/lib/server/respond";

/** Live chain conditions (block height, fees, throughput) for BTC, ETH, SOL and EVM L2s. */
export async function GET() {
  try {
    return ok(await getNetworkStats(), 5);
  } catch (e) {
    return fail(e, "RPC");
  }
}

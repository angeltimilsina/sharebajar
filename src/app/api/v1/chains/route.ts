import { CHAINS } from "@bajar/chain-adapters";
import { options, v1 } from "@/lib/api/v1";

/** Supported chains and their rollout phase. */
export async function GET(req: Request) {
  return v1(req, "chains", { ttlMs: 3600_000, maxAge: 3600 }, async () =>
    CHAINS.map(({ id, name, kind, phase, evmChainId, nativeSymbol, explorer }) => ({ id, name, kind, phase, evmChainId: evmChainId ?? null, nativeSymbol, explorer, source: "Bajar" })));
}
export const OPTIONS = options;

import "server-only";
import { cached } from "../server/cache";
import { fetchUpstream } from "../server/http";
import type { ChainInfo } from "../chains";
import { scoreEvm, scoreSolana, type RiskReport } from "./risk";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function getTokenSecurity(chain: ChainInfo, address: string) {
  const isSol = chain.type === "solana";
  const url = isSol
    ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`
    : `https://api.gopluslabs.io/api/v1/token_security/${chain.goplus}?contract_addresses=${address.toLowerCase()}`;
  return cached(`gp:${chain.id}:${address}`, "GoPlus", { ttlMs: 10 * 60_000, staleMs: 24 * 3600_000 }, async (): Promise<RiskReport | null> => {
    const raw = await fetchUpstream<{ code: number; message: string; result: Record<string, any> | null }>(url, { timeoutMs: 12_000 });
    const entry = raw.result ? Object.values(raw.result)[0] : null;
    if (!entry) return null;
    return isSol ? scoreSolana(entry) : scoreEvm(entry);
  });
}

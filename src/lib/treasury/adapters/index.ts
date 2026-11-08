import "server-only";
import { getChain } from "../../chains";
import { solanaAdapter } from "./solana";
import { evmAdapter } from "./evm";
import type { TreasuryAdapter } from "./types";

const ADAPTERS: Record<string, TreasuryAdapter> = { solana: solanaAdapter, evm: evmAdapter };

export function adapterFor(chain: string): TreasuryAdapter {
  const c = getChain(chain);
  if (!c) throw new Error(`Unsupported network: ${chain}`);
  const a = ADAPTERS[c.type];
  if (!a) throw new Error(`No treasury adapter for ${c.type}`);
  return a;
}

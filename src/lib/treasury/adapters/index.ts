import "server-only";
import { treasuryChain } from "../chainInfo";
import { bitcoinAdapter } from "./bitcoin";
import { solanaAdapter } from "./solana";
import { evmAdapter } from "./evm";
import type { TreasuryAdapter } from "./types";

const ADAPTERS: Record<string, TreasuryAdapter> = { solana: solanaAdapter, evm: evmAdapter, bitcoin: bitcoinAdapter };

export function adapterFor(chain: string): TreasuryAdapter {
  const c = treasuryChain(chain);
  if (!c) throw new Error(`Unsupported network: ${chain}`);
  const a = ADAPTERS[c.type];
  if (!a) throw new Error(`No treasury adapter for ${c.type}`);
  return a;
}

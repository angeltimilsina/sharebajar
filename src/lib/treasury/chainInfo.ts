import { getChain, type ChainInfo } from "../chains";

/**
 * Networks a treasury can live on: every market chain plus native Bitcoin
 * (Bitcoin is not a market/DEX chain, so it isn't in CHAINS).
 */
export interface TreasuryChain { id: string; name: string; type: "solana" | "evm" | "bitcoin"; nativeSymbol: string; evmChainId?: number; explorer: { tx: string; address: string; token: string } }

export const BITCOIN_TREASURY_CHAIN: TreasuryChain = {
  id: "bitcoin", name: "Bitcoin", type: "bitcoin", nativeSymbol: "BTC",
  explorer: { tx: "https://mempool.space/tx/", address: "https://mempool.space/address/", token: "https://mempool.space/address/" },
};

export function treasuryChain(id: string): TreasuryChain | undefined {
  if (id === "bitcoin") return BITCOIN_TREASURY_CHAIN;
  const c: ChainInfo | undefined = getChain(id);
  return c ? { id: c.id, name: c.name, type: c.type, nativeSymbol: c.nativeSymbol, evmChainId: c.evmChainId, explorer: c.explorer } : undefined;
}

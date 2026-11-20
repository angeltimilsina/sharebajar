import type { ChainConfig } from "./types.ts";

/**
 * Chain registry. Adding a chain = one entry here (provider ids + explorer);
 * the generic adapter does the rest. Phase 1 = Solana and Base.
 */
export const CHAINS: readonly ChainConfig[] = [
  {
    id: "solana", name: "Solana", kind: "solana", phase: 1, nativeSymbol: "SOL",
    providers: { geckoterminal: "solana", dexscreener: "solana", goplus: "solana" },
    explorer: { tx: "https://solscan.io/tx/", address: "https://solscan.io/account/", token: "https://solscan.io/token/" },
  },
  {
    id: "base", name: "Base", kind: "evm", phase: 1, evmChainId: 8453, nativeSymbol: "ETH",
    providers: { geckoterminal: "base", dexscreener: "base", goplus: "8453" },
    explorer: { tx: "https://basescan.org/tx/", address: "https://basescan.org/address/", token: "https://basescan.org/token/" },
  },
  {
    id: "arbitrum", name: "Arbitrum", kind: "evm", phase: 2, evmChainId: 42161, nativeSymbol: "ETH",
    providers: { geckoterminal: "arbitrum", dexscreener: "arbitrum", goplus: "42161" },
    explorer: { tx: "https://arbiscan.io/tx/", address: "https://arbiscan.io/address/", token: "https://arbiscan.io/token/" },
  },
  {
    id: "ethereum", name: "Ethereum", kind: "evm", phase: 2, evmChainId: 1, nativeSymbol: "ETH",
    providers: { geckoterminal: "eth", dexscreener: "ethereum", goplus: "1" },
    explorer: { tx: "https://etherscan.io/tx/", address: "https://etherscan.io/address/", token: "https://etherscan.io/token/" },
  },
  {
    id: "bsc", name: "BNB Chain", kind: "evm", phase: 2, evmChainId: 56, nativeSymbol: "BNB",
    providers: { geckoterminal: "bsc", dexscreener: "bsc", goplus: "56" },
    explorer: { tx: "https://bscscan.com/tx/", address: "https://bscscan.com/address/", token: "https://bscscan.com/token/" },
  },
];

export const chainById = (id: string | null | undefined): ChainConfig | undefined => CHAINS.find((c) => c.id === id);
export const chainByGecko = (id: string): ChainConfig | undefined => CHAINS.find((c) => c.providers.geckoterminal === id);
export const chainByDexscreener = (id: string): ChainConfig | undefined => CHAINS.find((c) => c.providers.dexscreener === id);

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;

/** Validates an address for a chain kind (no network call). */
export function isAddress(chain: ChainConfig, address: string): boolean {
  return chain.kind === "solana" ? SOL_ADDR.test(address) : EVM_ADDR.test(address);
}

/** Which chain kinds a raw query could be a contract address for. */
export function addressKind(q: string): "solana" | "evm" | null {
  if (EVM_ADDR.test(q)) return "evm";
  if (SOL_ADDR.test(q)) return "solana";
  return null;
}

/** EVM addresses are case-insensitive; Solana's are not. */
export const normalizeAddress = (chain: ChainConfig, a: string) => (chain.kind === "evm" ? a.toLowerCase() : a);

import type { ChainType } from "./types";

export interface ChainInfo {
  /** ShareBajar slug, also used in URLs: /token/[chain]/[address] */
  id: string;
  name: string;
  short: string;
  type: ChainType;
  /** DexScreener chainId */
  dexscreener: string;
  /** GeckoTerminal network id */
  geckoterminal: string;
  /** GoPlus chain id ("solana" uses a separate endpoint) */
  goplus: string;
  /** CoinGecko category for ecosystem filters */
  coingeckoCategory: string;
  evmChainId?: number;
  nativeSymbol: string;
  color: string;
  explorer: { tx: string; address: string; token: string };
}

export const CHAINS: ChainInfo[] = [
  {
    id: "solana", name: "Solana", short: "SOL", type: "solana",
    dexscreener: "solana", geckoterminal: "solana", goplus: "solana",
    coingeckoCategory: "solana-ecosystem", nativeSymbol: "SOL", color: "#14F195",
    explorer: { tx: "https://solscan.io/tx/", address: "https://solscan.io/account/", token: "https://solscan.io/token/" },
  },
  {
    id: "ethereum", name: "Ethereum", short: "ETH", type: "evm",
    dexscreener: "ethereum", geckoterminal: "eth", goplus: "1",
    coingeckoCategory: "ethereum-ecosystem", evmChainId: 1, nativeSymbol: "ETH", color: "#8A92B2",
    explorer: { tx: "https://etherscan.io/tx/", address: "https://etherscan.io/address/", token: "https://etherscan.io/token/" },
  },
  {
    id: "base", name: "Base", short: "BASE", type: "evm",
    dexscreener: "base", geckoterminal: "base", goplus: "8453",
    coingeckoCategory: "base-ecosystem", evmChainId: 8453, nativeSymbol: "ETH", color: "#0052FF",
    explorer: { tx: "https://basescan.org/tx/", address: "https://basescan.org/address/", token: "https://basescan.org/token/" },
  },
  {
    id: "bsc", name: "BNB Chain", short: "BNB", type: "evm",
    dexscreener: "bsc", geckoterminal: "bsc", goplus: "56",
    coingeckoCategory: "binance-smart-chain", evmChainId: 56, nativeSymbol: "BNB", color: "#F3BA2F",
    explorer: { tx: "https://bscscan.com/tx/", address: "https://bscscan.com/address/", token: "https://bscscan.com/token/" },
  },
  {
    id: "polygon", name: "Polygon", short: "POL", type: "evm",
    dexscreener: "polygon", geckoterminal: "polygon_pos", goplus: "137",
    coingeckoCategory: "polygon-ecosystem", evmChainId: 137, nativeSymbol: "POL", color: "#8247E5",
    explorer: { tx: "https://polygonscan.com/tx/", address: "https://polygonscan.com/address/", token: "https://polygonscan.com/token/" },
  },
  {
    id: "arbitrum", name: "Arbitrum", short: "ARB", type: "evm",
    dexscreener: "arbitrum", geckoterminal: "arbitrum", goplus: "42161",
    coingeckoCategory: "arbitrum-ecosystem", evmChainId: 42161, nativeSymbol: "ETH", color: "#28A0F0",
    explorer: { tx: "https://arbiscan.io/tx/", address: "https://arbiscan.io/address/", token: "https://arbiscan.io/token/" },
  },
  {
    id: "avalanche", name: "Avalanche", short: "AVAX", type: "evm",
    dexscreener: "avalanche", geckoterminal: "avax", goplus: "43114",
    coingeckoCategory: "avalanche-ecosystem", evmChainId: 43114, nativeSymbol: "AVAX", color: "#E84142",
    explorer: { tx: "https://snowtrace.io/tx/", address: "https://snowtrace.io/address/", token: "https://snowtrace.io/token/" },
  },
  {
    id: "optimism", name: "Optimism", short: "OP", type: "evm",
    dexscreener: "optimism", geckoterminal: "optimism", goplus: "10",
    coingeckoCategory: "optimism-ecosystem", evmChainId: 10, nativeSymbol: "ETH", color: "#FF0420",
    explorer: { tx: "https://optimistic.etherscan.io/tx/", address: "https://optimistic.etherscan.io/address/", token: "https://optimistic.etherscan.io/token/" },
  },
];

/** Chains shown as primary filter chips (rest go under "More"). */
export const PRIMARY_CHAIN_IDS = ["solana", "ethereum", "base", "bsc", "polygon", "arbitrum"];

const byId = new Map(CHAINS.map((c) => [c.id, c]));
const byDexscreener = new Map(CHAINS.map((c) => [c.dexscreener, c]));
const byGecko = new Map(CHAINS.map((c) => [c.geckoterminal, c]));
const byEvmId = new Map(CHAINS.filter((c) => c.evmChainId).map((c) => [c.evmChainId!, c]));

export const getChain = (id: string | null | undefined) => (id ? byId.get(id) : undefined);
export const chainFromDexscreener = (id: string) => byDexscreener.get(id);
export const chainFromGecko = (id: string) => byGecko.get(id);
export const chainFromEvmId = (id: number) => byEvmId.get(id);

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function detectAddress(input: string): { chainType: ChainType; address: string } | null {
  const s = input.trim();
  if (EVM_ADDRESS.test(s)) return { chainType: "evm", address: s };
  if (SOLANA_ADDRESS.test(s)) return { chainType: "solana", address: s };
  return null;
}

export function isValidAddressFor(chain: ChainInfo, address: string): boolean {
  return chain.type === "evm" ? EVM_ADDRESS.test(address) : SOLANA_ADDRESS.test(address);
}

/**
 * Well-known fee tokens per network (verified contract addresses).
 * Admins can add others; every token is validated on-chain before use.
 */
export interface KnownToken { token: string; symbol: string; decimals: number; stable?: boolean; native?: boolean }

export const NATIVE_EVM = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const WSOL = "So11111111111111111111111111111111111111112";

export const KNOWN_TOKENS: Record<string, KnownToken[]> = {
  solana: [
    { token: WSOL, symbol: "SOL", decimals: 9 },
    { token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, stable: true },
    { token: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6, stable: true },
    { token: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", decimals: 6 },
  ],
  ethereum: [
    { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6, stable: true },
    { token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6, stable: true },
    { token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18 },
    { token: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", decimals: 18, stable: true },
  ],
  base: [
    { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, stable: true },
    { token: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
  ],
  arbitrum: [
    { token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", decimals: 6, stable: true },
    { token: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USDT", decimals: 6, stable: true },
    { token: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", symbol: "WETH", decimals: 18 },
  ],
  optimism: [
    { token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", decimals: 6, stable: true },
    { token: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", symbol: "USDT", decimals: 6, stable: true },
    { token: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
  ],
  polygon: [
    { token: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", decimals: 6, stable: true },
    { token: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", symbol: "USDT", decimals: 6, stable: true },
    { token: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", symbol: "WETH", decimals: 18 },
  ],
  bsc: [
    { token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", decimals: 18, stable: true },
    { token: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", decimals: 18, stable: true },
    { token: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", symbol: "WBNB", decimals: 18 },
  ],
  avalanche: [
    { token: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", symbol: "USDC", decimals: 6, stable: true },
    { token: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", symbol: "USDT", decimals: 6, stable: true },
    { token: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", symbol: "WAVAX", decimals: 18 },
  ],
};

export const sameToken = (a: string, b: string) => (a.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b);

export function knownToken(chain: string, token: string): KnownToken | undefined {
  return KNOWN_TOKENS[chain]?.find((t) => sameToken(t.token, token));
}

/** Price symbol used for timestamped USD valuation (Binance <SYM>USDT). */
export function priceSymbol(symbol: string): string | null {
  const s = symbol.toUpperCase();
  if (["USDC", "USDT", "DAI", "USDE", "FDUSD", "PYUSD", "USDS"].includes(s)) return "USD";
  const map: Record<string, string> = { WETH: "ETH", WSOL: "SOL", WBNB: "BNB", WAVAX: "AVAX", WPOL: "POL", WMATIC: "POL" };
  return map[s] ?? s;
}

/** 0x Swap API chain ids (confirmed against /swap/chains). */
export const ZEROX_CHAINS: Record<string, number> = { ethereum: 1, base: 8453, arbitrum: 42161, optimism: 10, polygon: 137, bsc: 56, avalanche: 43114 };

/** Confirmations required before revenue counts as settled. */
export const CONFIRMATIONS: Record<string, number> = { ethereum: 12, base: 30, arbitrum: 30, optimism: 30, polygon: 64, bsc: 15, avalanche: 12 };

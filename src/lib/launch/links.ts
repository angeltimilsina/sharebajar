/** Where a creator adds liquidity for a new token (opens the DEX; you sign there). */
export function liquidityLinks(chain: string, token: string): { label: string; href: string }[] {
  switch (chain) {
    case "solana":
      return [
        { label: "Raydium", href: "https://raydium.io/liquidity/create-pool/" },
        { label: "Meteora", href: "https://app.meteora.ag/pools/create" },
        { label: "Orca", href: "https://www.orca.so/pools" },
      ];
    case "ethereum":
      return [{ label: "Uniswap", href: `https://app.uniswap.org/positions/create?chain=ethereum&currencyA=NATIVE&currencyB=${token}` }];
    case "base":
      return [
        { label: "Uniswap", href: `https://app.uniswap.org/positions/create?chain=base&currencyA=NATIVE&currencyB=${token}` },
        { label: "Aerodrome", href: "https://aerodrome.finance/liquidity" },
      ];
    case "bsc":
      return [
        { label: "PancakeSwap", href: `https://pancakeswap.finance/add/BNB/${token}?chain=bsc` },
        { label: "Uniswap", href: `https://app.uniswap.org/positions/create?chain=bnb&currencyA=NATIVE&currencyB=${token}` },
      ];
    default:
      return [];
  }
}

export const EXPLORER: Record<string, string> = { solana: "https://solscan.io/token/", ethereum: "https://etherscan.io/token/", base: "https://basescan.org/token/", bsc: "https://bscscan.com/token/" };

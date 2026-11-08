import index from "./logos-index.json";

/**
 * Self-hosted brand logos (public/logos, built by scripts/build-logos.mjs from
 * open icon sets). Logos identify assets and institutions; they are only used
 * for canonical assets — on-chain tokens show their own image so a look-alike
 * token can never borrow a famous logo.
 */
const TOKENS = new Set(index.tokens);
const NETWORKS = new Set(index.networks);
const WALLETS = new Set(index.wallets);
const EXCHANGES = new Set(index.exchanges);

/** Logo for a canonical asset by ticker (BTC, ETH, SOL, USDC…). */
export function tokenLogo(symbol: string | null | undefined): string | null {
  const s = (symbol ?? "").toUpperCase().replace(/^\$/, "");
  if (!s) return null;
  if (TOKENS.has(s)) return `/logos/tokens/${s}.svg`;
  const alias: Record<string, string> = { WETH: "ETH", WSOL: "SOL", "USDC.E": "USDC", MATIC: "POL", WBNB: "BNB", WAVAX: "AVAX", WPOL: "POL" };
  return alias[s] && TOKENS.has(alias[s]) ? `/logos/tokens/${alias[s]}.svg` : null;
}

const CHAIN_LOGO: Record<string, string> = {
  bitcoin: "bitcoin", ethereum: "ethereum", solana: "solana", base: "base", bsc: "binance-smart-chain",
  polygon: "polygon", arbitrum: "arbitrum-one", avalanche: "avalanche", optimism: "optimism",
};
export function chainLogo(chain: string): string | null {
  const n = CHAIN_LOGO[chain] ?? chain;
  return NETWORKS.has(n) ? `/logos/networks/${n}.svg` : null;
}

const WALLET_LOGO: Record<string, string> = { "io.metamask": "metamask", "app.phantom": "phantom", "com.coinbase.wallet": "coinbase", "com.trustwallet.app": "trust", "io.rabby": "rabby", "me.rainbow": "rainbow", "com.okex.wallet": "okx" };
export function walletLogo(id: string): string | null {
  const n = WALLET_LOGO[id] ?? id.toLowerCase();
  return WALLETS.has(n) ? `/logos/wallets/${n}.svg` : null;
}

/** Exchanges and DEXs by display name ("Binance", "Crypto.com", "Uniswap V3"…). */
export function exchangeLogo(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase()
    .replace(/\s*\(.*\)$/, "").replace(/\s+v\d+.*$/, "").replace(/\.com$/, "-com").replace(/\.io$/, "-io")
    .replace(/^okex$/, "okx").replace(/^coinbase.*$/, "coinbase").replace(/^gate$/, "gate-io").replace(/^pancakeswap$/, "pancake-swap").replace(/^paraswap$/, "para-swap")
    .replace(/\s+/g, "-");
  return EXCHANGES.has(n) ? `/logos/exchanges/${n}.svg` : null;
}

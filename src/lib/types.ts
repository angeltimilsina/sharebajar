/**
 * Every API response from ShareBajar's backend is wrapped in an envelope so the
 * UI can always say where data came from and how fresh it is.
 */
export interface Envelope<T> {
  data: T;
  /** Upstream provider, e.g. "CoinLore + Binance". */
  source: string;
  /** Unix ms when the upstream data was fetched. */
  fetchedAt: number;
  /** True when serving a cached copy because the upstream failed. */
  stale: boolean;
  error?: string;
}

export interface ApiError {
  error: string;
  source?: string;
  retryAfter?: number;
}

export type ChainType = "solana" | "evm";

export interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  rank: number | null;
  price: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  marketCap: number | null;
  fdv: number | null;
  volume24h: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  high24h: number | null;
  low24h: number | null;
  ath: number | null;
  sparkline: number[];
  lastUpdated: string | null;
}

export interface GlobalStats {
  totalMarketCap: number;
  totalVolume: number;
  marketCapChange24h: number;
  btcDominance: number;
  ethDominance: number;
  activeCryptocurrencies: number;
  markets: number;
  updatedAt: number;
}

export interface TvlStats {
  tvl: number;
  change24h: number;
  series: number[];
}

export interface DexPair {
  chain: string;
  dex: string;
  pairAddress: string;
  url: string;
  base: { address: string; name: string; symbol: string };
  quote: { address: string; name: string; symbol: string };
  priceUsd: number | null;
  priceNative: number | null;
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  volume: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  liquidityUsd: number | null;
  fdv: number | null;
  marketCap: number | null;
  createdAt: number | null;
  imageUrl: string | null;
  websites: { label: string; url: string }[];
  socials: { type: string; url: string }[];
  labels: string[];
}

export interface Pool {
  id: string;
  network: string;
  address: string;
  name: string;
  dex: string;
  base: { address: string; symbol: string; name: string; image: string | null };
  quote: { address: string; symbol: string };
  priceUsd: number | null;
  fdv: number | null;
  marketCap: number | null;
  reserveUsd: number | null;
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  volume: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  txns: { h1: { buys: number; sells: number }; h24: { buys: number; sells: number } };
  createdAt: number | null;
}

export interface Candle {
  /** Bucket start, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Base volume bought by takers (Binance) or buy-side volume (DEX). */
  buyVolume?: number;
  trades?: number;
}

export interface Trade {
  id: string;
  /** unix ms */
  time: number;
  side: "buy" | "sell";
  price: number;
  /** base token amount */
  amount: number;
  /** USD (or quote) notional */
  notional: number;
  maker?: string;
  txHash?: string;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  summary: string;
  image: string | null;
}

export interface SearchResult {
  coins: { id: string; name: string; symbol: string; thumb: string | null; rank: number | null }[];
  pairs: DexPair[];
  addressQuery: { chainType: ChainType; address: string } | null;
}

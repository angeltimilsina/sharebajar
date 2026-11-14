/**
 * @bajar/chain-adapters — the unified market schema.
 *
 * Every chain adapter returns these shapes, whatever provider the data came
 * from. Unknown values are `null`, never guessed: a field a provider didn't
 * return stays null and the UI shows it as unavailable.
 */

export type ChainKind = "solana" | "evm";

export interface ChainConfig {
  /** Bajar slug used in URLs and the API: /token/{id}/{address} */
  id: string;
  name: string;
  kind: ChainKind;
  /** Rollout priority: phase-1 chains are fully supported first. */
  phase: 1 | 2;
  evmChainId?: number;
  nativeSymbol: string;
  /** Provider network ids. */
  providers: { geckoterminal: string; dexscreener: string; goplus: string };
  explorer: { tx: string; address: string; token: string };
}

/** One normalized liquidity pool (a DEX pair). */
export interface PoolSummary {
  chain: string;
  address: string;
  dex: string;
  name: string;
  base: TokenRef;
  quote: TokenRef;
  priceUsd: number | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  volumeUsd: Window<number | null>;
  priceChangePct: Window<number | null>;
  txns: { h1: BuysSells | null; h24: BuysSells | null };
  createdAt: number | null;
  source: string;
}

export interface TokenRef { address: string; symbol: string; name: string; image: string | null }
export interface BuysSells { buys: number; sells: number }
export interface Window<T> { m5: T; h1: T; h6: T; h24: T }

/** A token's market profile, aggregated from its pools. */
export interface TokenSummary {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  image: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  holders: number | null;
  /** Deepest pool by liquidity: where charts and trades come from. */
  topPool: string | null;
  poolCount: number;
  links: { website: string | null; twitter: string | null; telegram: string | null };
  source: string;
}

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface Trade {
  txHash: string;
  time: number;
  side: "buy" | "sell";
  priceUsd: number | null;
  amountUsd: number | null;
  baseAmount: number | null;
  wallet: string | null;
}

export type RiskLevel = "low" | "medium" | "high" | "unknown";
export interface RiskSignal { key: string; level: Exclude<RiskLevel, "unknown">; label: string; detail: string }
export interface RiskSummary {
  chain: string;
  address: string;
  level: RiskLevel;
  honeypot: boolean | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  /** Owner can mint, pause, blacklist, change balances or upgrade the contract (EVM), or freeze/mint (Solana). */
  permissions: { mintable: boolean | null; freezable: boolean | null; ownerChangeBalance: boolean | null; proxy: boolean | null; renounced: boolean | null };
  holders: { count: number | null; top10Pct: number | null };
  /** Share of liquidity that is locked or burned, when the provider reports it. */
  lockedLiquidityPct: number | null;
  signals: RiskSignal[];
  source: string;
}

/** Fetches JSON; the host app supplies it (caching, timeouts, proxy, metrics). */
export type FetchJson = <T = unknown>(url: string, init?: { headers?: Record<string, string> }) => Promise<T>;

export interface ChainAdapter {
  readonly chain: ChainConfig;
  trending(opts?: { window?: "5m" | "1h" | "6h" | "24h" }): Promise<PoolSummary[]>;
  newPools(): Promise<PoolSummary[]>;
  topPools(): Promise<PoolSummary[]>;
  search(query: string): Promise<PoolSummary[]>;
  token(address: string): Promise<TokenSummary | null>;
  tokenPools(address: string): Promise<PoolSummary[]>;
  pool(address: string): Promise<PoolSummary | null>;
  ohlcv(pool: string, timeframe: Timeframe, opts?: { limit?: number; before?: number }): Promise<Candle[]>;
  trades(pool: string, opts?: { baseToken?: string }): Promise<Trade[]>;
  risk(address: string): Promise<RiskSummary>;
}

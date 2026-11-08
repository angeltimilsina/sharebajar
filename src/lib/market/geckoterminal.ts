import "server-only";
import { cached } from "../server/cache";
import { fetchUpstream } from "../server/http";
import { toNum } from "../format";
import { chainFromGecko } from "../chains";
import type { Candle, Pool, Trade } from "../types";

const SOURCE = "GeckoTerminal";
// Free tier ≈30 calls/min (paced + cached). With COINGECKO_API_KEY the same
// on-chain data comes from CoinGecko's paid API (≈500 calls/min).
const PRO_KEY = process.env.COINGECKO_API_KEY;
const BASE = PRO_KEY ? "https://pro-api.coingecko.com/api/v3/onchain" : "https://api.geckoterminal.com/api/v2";
const gt = <T>(path: string) => fetchUpstream<T>(`${BASE}${path}`, {
  headers: { accept: "application/json;version=20230302", ...(PRO_KEY ? { "x-cg-pro-api-key": PRO_KEY } : {}) },
  timeoutMs: 12_000,
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizePools(raw: { data: any[]; included?: any[] }): Pool[] {
  const inc = new Map<string, any>((raw.included ?? []).map((i) => [i.id, i]));
  return (raw.data ?? []).map((p) => {
    const a = p.attributes ?? {};
    const baseId = p.relationships?.base_token?.data?.id as string | undefined;
    const quoteId = p.relationships?.quote_token?.data?.id as string | undefined;
    const dexId = p.relationships?.dex?.data?.id as string | undefined;
    const baseTok = baseId ? inc.get(baseId)?.attributes : undefined;
    const quoteTok = quoteId ? inc.get(quoteId)?.attributes : undefined;
    const dex = dexId ? inc.get(dexId)?.attributes?.name ?? dexId : "unknown";
    const network = String(p.id).split("_")[0];
    const [nameBase, nameQuote] = String(a.name ?? "").split(" / ");
    const t = a.transactions ?? {};
    return {
      id: p.id,
      network: chainFromGecko(network)?.id ?? network,
      address: a.address,
      name: a.name ?? "",
      dex,
      base: {
        address: baseTok?.address ?? baseId?.split("_").slice(1).join("_") ?? "",
        symbol: baseTok?.symbol ?? nameBase ?? "",
        name: baseTok?.name ?? nameBase ?? "",
        image: baseTok?.image_url && baseTok.image_url !== "missing.png" ? baseTok.image_url : null,
      },
      quote: { address: quoteTok?.address ?? quoteId?.split("_").slice(1).join("_") ?? "", symbol: quoteTok?.symbol ?? nameQuote ?? "" },
      priceUsd: toNum(a.base_token_price_usd),
      fdv: toNum(a.fdv_usd),
      marketCap: toNum(a.market_cap_usd),
      reserveUsd: toNum(a.reserve_in_usd),
      change: {
        m5: toNum(a.price_change_percentage?.m5), h1: toNum(a.price_change_percentage?.h1),
        h6: toNum(a.price_change_percentage?.h6), h24: toNum(a.price_change_percentage?.h24),
      },
      volume: { m5: toNum(a.volume_usd?.m5), h1: toNum(a.volume_usd?.h1), h6: toNum(a.volume_usd?.h6), h24: toNum(a.volume_usd?.h24) },
      txns: {
        h1: { buys: Number(t.h1?.buys ?? 0), sells: Number(t.h1?.sells ?? 0) },
        h24: { buys: Number(t.h24?.buys ?? 0), sells: Number(t.h24?.sells ?? 0) },
      },
      createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
    };
  });
}

/** network = GeckoTerminal network id, or undefined for all networks. */
export function getTrendingPools(network?: string, duration: "5m" | "1h" | "6h" | "24h" = "24h") {
  const path = network
    ? `/networks/${network}/trending_pools?include=base_token,quote_token,dex&duration=${duration}`
    : `/networks/trending_pools?include=base_token,quote_token,dex&duration=${duration}`;
  return cached(`gt:${path}`, SOURCE, { ttlMs: 60_000, staleMs: 30 * 60_000 }, async () => normalizePools(await gt(path)));
}

export function getNewPools(network?: string) {
  const path = network ? `/networks/${network}/new_pools?include=base_token,quote_token,dex` : `/networks/new_pools?include=base_token,quote_token,dex`;
  return cached(`gt:${path}`, SOURCE, { ttlMs: 30_000, staleMs: 30 * 60_000 }, async () => normalizePools(await gt(path)));
}

export function getTopPools(network: string, sort: "h24_volume_usd_desc" | "h24_tx_count_desc" = "h24_volume_usd_desc") {
  const path = `/networks/${network}/pools?include=base_token,quote_token,dex&sort=${sort}`;
  return cached(`gt:${path}`, SOURCE, { ttlMs: 60_000, staleMs: 30 * 60_000 }, async () => normalizePools(await gt(path)));
}

export type GtTimeframe = "minute" | "hour" | "day";

export function getPoolOhlcv(network: string, pool: string, timeframe: GtTimeframe, aggregate: number, limit = 300) {
  const path = `/networks/${network}/pools/${pool}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=base`;
  const ttl = timeframe === "minute" ? 20_000 : 120_000;
  return cached(`gt:${path}`, SOURCE, { ttlMs: ttl, staleMs: 30 * 60_000 }, async (): Promise<Candle[]> => {
    const raw = await gt<{ data: { attributes: { ohlcv_list: number[][] } } }>(path);
    return (raw.data?.attributes?.ohlcv_list ?? [])
      .map(([t, o, h, l, c, v]) => ({ time: t, open: o, high: h, low: l, close: c, volume: v }))
      .sort((a, b) => a.time - b.time);
  });
}

/** Last ~300 trades in the pool (past 24h), newest first. */
export function getPoolTrades(network: string, pool: string, baseAddress?: string) {
  const path = `/networks/${network}/pools/${pool}/trades`;
  return cached(`gt:${path}`, SOURCE, { ttlMs: PRO_KEY ? 4000 : 8000, staleMs: 5 * 60_000 }, async (): Promise<Trade[]> => {
    const raw = await gt<{ data: any[] }>(path);
    return (raw.data ?? []).map((t) => {
      const a = t.attributes;
      const buy = a.kind === "buy";
      // For buys the base token is the "to" side; for sells it is "from".
      const amount = Number(buy ? a.to_token_amount : a.from_token_amount);
      const price = Number(buy ? a.price_to_in_usd : a.price_from_in_usd);
      const usd = toNum(a.volume_in_usd) ?? amount * price;
      void baseAddress;
      return {
        id: t.id,
        time: Date.parse(a.block_timestamp),
        side: buy ? "buy" : "sell",
        price,
        amount,
        notional: usd,
        maker: a.tx_from_address,
        txHash: a.tx_hash,
      } satisfies Trade;
    });
  });
}

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  image: string | null;
  description: string | null;
  websites: string[];
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  coingeckoId: string | null;
  verified: boolean;
  score: number | null;
  holders: { count: number | null; top10: number | null; top11to20: number | null; top21to40: number | null; rest: number | null; updatedAt: string | null } | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  honeypot: string | null;
  developerHoldingPct: number | null;
}

export function getTokenInfo(network: string, address: string) {
  const path = `/networks/${network}/tokens/${address}/info`;
  return cached(`gt:${path}`, SOURCE, { ttlMs: 10 * 60_000, staleMs: 6 * 3600_000 }, async (): Promise<TokenInfo> => {
    const raw = await gt<{ data: { attributes: any } }>(path);
    const a = raw.data.attributes;
    const d = a.holders?.distribution_percentage;
    return {
      address: a.address, name: a.name, symbol: a.symbol,
      image: a.image_url && a.image_url !== "missing.png" ? a.image_url : null,
      description: a.description ? String(a.description).slice(0, 1200) : null,
      websites: a.websites ?? [],
      twitter: a.twitter_handle ? `https://x.com/${a.twitter_handle}` : null,
      telegram: a.telegram_handle ? `https://t.me/${a.telegram_handle}` : null,
      discord: a.discord_url ?? null,
      coingeckoId: a.coingecko_coin_id ?? null,
      verified: Boolean(a.gt_verified),
      score: toNum(a.gt_score),
      holders: a.holders
        ? {
            count: toNum(a.holders.count), top10: toNum(d?.top_10), top11to20: toNum(d?.["11_20"]),
            top21to40: toNum(d?.["21_40"]), rest: toNum(d?.rest), updatedAt: a.holders.last_updated ?? null,
          }
        : null,
      mintAuthority: a.mint_authority ?? null,
      freezeAuthority: a.freeze_authority ?? null,
      honeypot: a.is_honeypot ?? null,
      developerHoldingPct: toNum(a.developer_holding_percentage),
    };
  });
}

/** Map our resolution to GeckoTerminal timeframe/aggregate. */
export function gtResolution(res: string): { timeframe: GtTimeframe; aggregate: number } | null {
  const map: Record<string, { timeframe: GtTimeframe; aggregate: number }> = {
    "1m": { timeframe: "minute", aggregate: 1 }, "5m": { timeframe: "minute", aggregate: 5 },
    "15m": { timeframe: "minute", aggregate: 15 }, "1h": { timeframe: "hour", aggregate: 1 },
    "4h": { timeframe: "hour", aggregate: 4 }, "1d": { timeframe: "day", aggregate: 1 },
  };
  return map[res] ?? null;
}

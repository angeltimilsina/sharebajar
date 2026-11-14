import type { Candle, ChainConfig, FetchJson, PoolSummary, Timeframe, TokenSummary, Trade } from "../types.ts";
import { chainByGecko } from "../chains.ts";

/**
 * GeckoTerminal (on-chain DEX data). Free tier ≈30 calls/min; with a
 * CoinGecko key the same data comes from the paid on-chain API.
 */
export const GT_SOURCE = "GeckoTerminal";
export interface GtOptions { apiKey?: string }

const base = (o: GtOptions) => (o.apiKey ? "https://pro-api.coingecko.com/api/v3/onchain" : "https://api.geckoterminal.com/api/v2");
const headers = (o: GtOptions): Record<string, string> => ({ accept: "application/json;version=20230302", ...(o.apiKey ? { "x-cg-pro-api-key": o.apiKey } : {}) });
const INCLUDE = "include=base_token,quote_token,dex";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const img = (u: unknown) => (typeof u === "string" && u && u !== "missing.png" ? u : null);

/** Raw GeckoTerminal pools (JSON:API with `included`) → unified pools. Pure. */
export function parsePools(raw: { data?: any[] | any; included?: any[] }): PoolSummary[] {
  const list = Array.isArray(raw.data) ? raw.data : raw.data ? [raw.data] : [];
  const inc = new Map<string, any>((raw.included ?? []).map((i) => [i.id, i]));
  return list.map((p) => {
    const a = p.attributes ?? {};
    const network = String(p.id ?? "").split("_")[0];
    const ref = (rel: string) => {
      const id = p.relationships?.[rel]?.data?.id as string | undefined;
      const t = id ? inc.get(id)?.attributes : undefined;
      return { id, t };
    };
    const b = ref("base_token"), q = ref("quote_token"), d = ref("dex");
    const [nb, nq] = String(a.name ?? "").split(" / ");
    const fromId = (id?: string) => (id ? id.split("_").slice(1).join("_") : "");
    const tx = a.transactions ?? {};
    const bs = (w: any) => (w ? { buys: Number(w.buys ?? 0), sells: Number(w.sells ?? 0) } : null);
    return {
      chain: chainByGecko(network)?.id ?? network,
      address: String(a.address ?? ""),
      dex: d.t?.name ?? fromId(d.id) ?? "unknown",
      name: String(a.name ?? ""),
      base: { address: b.t?.address ?? fromId(b.id), symbol: b.t?.symbol ?? nb ?? "", name: b.t?.name ?? nb ?? "", image: img(b.t?.image_url) },
      quote: { address: q.t?.address ?? fromId(q.id), symbol: q.t?.symbol ?? nq ?? "", name: q.t?.name ?? nq ?? "", image: img(q.t?.image_url) },
      priceUsd: num(a.base_token_price_usd),
      liquidityUsd: num(a.reserve_in_usd),
      fdvUsd: num(a.fdv_usd),
      marketCapUsd: num(a.market_cap_usd),
      volumeUsd: { m5: num(a.volume_usd?.m5), h1: num(a.volume_usd?.h1), h6: num(a.volume_usd?.h6), h24: num(a.volume_usd?.h24) },
      priceChangePct: { m5: num(a.price_change_percentage?.m5), h1: num(a.price_change_percentage?.h1), h6: num(a.price_change_percentage?.h6), h24: num(a.price_change_percentage?.h24) },
      txns: { h1: bs(tx.h1), h24: bs(tx.h24) },
      createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
      source: GT_SOURCE,
    };
  });
}

/** Raw OHLCV list ([ts, o, h, l, c, v], newest first) → ascending candles. Pure. */
export function parseOhlcv(raw: any): Candle[] {
  const list: any[] = raw?.data?.attributes?.ohlcv_list ?? [];
  return list
    .map((r) => ({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) }))
    .filter((c) => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);
}

/** Raw trades → unified trades (base-token side). Pure. */
export function parseTrades(raw: any): Trade[] {
  return (raw?.data ?? []).map((t: any) => {
    const a = t.attributes ?? {};
    const buy = a.kind === "buy";
    return {
      txHash: String(a.tx_hash ?? ""),
      time: Date.parse(a.block_timestamp),
      side: buy ? "buy" : "sell",
      priceUsd: num(buy ? a.price_to_in_usd : a.price_from_in_usd),
      amountUsd: num(a.volume_in_usd),
      baseAmount: num(buy ? a.to_token_amount : a.from_token_amount),
      wallet: a.tx_from_address ?? null,
    } satisfies Trade;
  }).filter((t: Trade) => Number.isFinite(t.time));
}

/** Token attributes + info → token summary (pool stats filled in by the adapter). Pure. */
export function parseToken(chainId: string, token: any, info: any | null): Omit<TokenSummary, "topPool" | "poolCount"> {
  const a = token?.data?.attributes ?? {};
  const i = info?.data?.attributes ?? {};
  return {
    chain: chainId,
    address: String(a.address ?? i.address ?? ""),
    symbol: String(a.symbol ?? i.symbol ?? ""),
    name: String(a.name ?? i.name ?? ""),
    image: img(a.image_url) ?? img(i.image_url),
    priceUsd: num(a.price_usd),
    marketCapUsd: num(a.market_cap_usd),
    fdvUsd: num(a.fdv_usd),
    liquidityUsd: num(a.total_reserve_in_usd),
    volume24hUsd: num(a.volume_usd?.h24),
    priceChange24hPct: null,
    holders: num(i.holders?.count),
    links: {
      website: Array.isArray(i.websites) && i.websites[0] ? String(i.websites[0]) : null,
      twitter: i.twitter_handle ? `https://x.com/${i.twitter_handle}` : null,
      telegram: i.telegram_handle ? `https://t.me/${i.telegram_handle}` : null,
    },
    source: GT_SOURCE,
  };
}

const TF: Record<Timeframe, { tf: "minute" | "hour" | "day"; agg: number }> = {
  "1m": { tf: "minute", agg: 1 }, "5m": { tf: "minute", agg: 5 }, "15m": { tf: "minute", agg: 15 },
  "1h": { tf: "hour", agg: 1 }, "4h": { tf: "hour", agg: 4 }, "1d": { tf: "day", agg: 1 },
};

/** Network calls (thin; parsing above is pure and unit-tested). */
export function geckoTerminal(fetchJson: FetchJson, o: GtOptions = {}) {
  const get = <T>(path: string) => fetchJson<T>(`${base(o)}${path}`, { headers: headers(o) });
  const net = (c: ChainConfig) => c.providers.geckoterminal;
  return {
    trending: async (c: ChainConfig, window: string) => parsePools(await get(`/networks/${net(c)}/trending_pools?${INCLUDE}&duration=${window}`)),
    newPools: async (c: ChainConfig) => parsePools(await get(`/networks/${net(c)}/new_pools?${INCLUDE}`)),
    topPools: async (c: ChainConfig) => parsePools(await get(`/networks/${net(c)}/pools?${INCLUDE}&sort=h24_volume_usd_desc`)),
    pool: async (c: ChainConfig, addr: string) => parsePools(await get(`/networks/${net(c)}/pools/${addr}?${INCLUDE}`))[0] ?? null,
    tokenPools: async (c: ChainConfig, addr: string) => parsePools(await get(`/networks/${net(c)}/tokens/${addr}/pools?${INCLUDE}`)),
    token: async (c: ChainConfig, addr: string) => {
      const [t, info] = await Promise.all([get<any>(`/networks/${net(c)}/tokens/${addr}`), get<any>(`/networks/${net(c)}/tokens/${addr}/info`).catch(() => null)]);
      return parseToken(c.id, t, info);
    },
    ohlcv: async (c: ChainConfig, pool: string, tf: Timeframe, limit = 300, before?: number) => {
      const m = TF[tf];
      const q = new URLSearchParams({ aggregate: String(m.agg), limit: String(Math.min(1000, Math.max(1, limit))), currency: "usd" });
      if (before) q.set("before_timestamp", String(before));
      return parseOhlcv(await get(`/networks/${net(c)}/pools/${pool}/ohlcv/${m.tf}?${q}`));
    },
    trades: async (c: ChainConfig, pool: string) => parseTrades(await get(`/networks/${net(c)}/pools/${pool}/trades`)),
  };
}

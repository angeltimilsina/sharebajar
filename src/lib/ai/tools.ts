import "server-only";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getCoin, getGlobal, getMarkets } from "../market/coingecko";
import { getDefiTvl } from "../market/defillama";
import { getKlines, binanceSymbolFor, type BinanceInterval } from "../market/binance";
import { getTokenPairs, searchPairs } from "../market/dexscreener";
import { getTokenInfo, getTrendingPools } from "../market/geckoterminal";
import { getTokenSecurity } from "../security/goplus";
import { getNews } from "../news/feeds";
import { filterNews } from "../news/rss";
import { getChain, CHAINS } from "../chains";
import { bollinger, closes, ema, macd, rsi, sma, vwap, buyerSellerRatio } from "../analytics/indicators";
import { poolSignals } from "../analytics/signals";
import { errorMessage } from "../server/cache";
import type { AiAction } from "./config";

const r = (n: number | null | undefined, d = 4) => (n === null || n === undefined || !Number.isFinite(n) ? null : Number(n.toPrecision(d + 2)));
const meta = (env: { source: string; fetchedAt: number; stale: boolean }) => ({ source: env.source, fetchedAt: new Date(env.fetchedAt).toISOString(), stale: env.stale });
const json = (o: unknown) => JSON.stringify(o);
const safe = (fn: () => Promise<string>) => fn().catch((e) => json({ error: errorMessage(e) }));
const chainIds = CHAINS.map((c) => c.id) as [string, ...string[]];

export function buildTools(emit: { action: (a: AiAction) => void }) {
  return [
    betaZodTool({
      name: "get_market_overview",
      description: "Global crypto market snapshot: total market cap, 24h volume, BTC/ETH dominance, DeFi TVL and the top 15 coins by market cap with 1h/24h/7d changes.",
      inputSchema: z.object({}),
      eager_input_streaming: true,
      run: () => safe(async () => {
        const [g, t, m] = await Promise.allSettled([getGlobal(), getDefiTvl(), getMarkets({ perPage: 100 })]);
        return json({
          global: g.status === "fulfilled" ? { ...g.value.data, ...meta(g.value) } : { error: errorMessage(g.reason) },
          defiTvl: t.status === "fulfilled" ? { tvl: t.value.data.tvl, change24h: r(t.value.data.change24h), ...meta(t.value) } : null,
          topCoins: m.status === "fulfilled" ? m.value.data.slice(0, 15).map((c) => ({ id: c.id, symbol: c.symbol, price: c.price, change1h: r(c.change1h, 2), change24h: r(c.change24h, 2), change7d: r(c.change7d, 2), marketCap: c.marketCap, volume24h: c.volume24h })) : null,
        });
      }),
    }),
    betaZodTool({
      name: "get_coin",
      description: "Detailed market data for a listed coin by CoinGecko id (e.g. 'bitcoin', 'solana'): price, changes, market cap, FDV, supply, ATH, categories, contract addresses.",
      inputSchema: z.object({ id: z.string().min(1).max(80) }),
      eager_input_streaming: true,
      run: ({ id }) => safe(async () => {
        const env = await getCoin(id);
        const c = env.data;
        const { sparkline: _s, ...market } = c.market;
        void _s;
        return json({ ...meta(env), id: c.id, name: c.name, symbol: c.symbol, categories: c.categories, platforms: c.platforms, market, ath: c.ath, athDate: c.athDate, description: c.description.slice(0, 500) });
      }),
    }),
    betaZodTool({
      name: "get_technical_analysis",
      description: "Computes technical indicators from real Binance OHLCV candles for a coin symbol (e.g. 'BTC'): SMA20/50, EMA21, RSI14, MACD(12,26,9), Bollinger(20,2), VWAP, taker buy ratio, recent range. Use for indicator explanations and technical questions.",
      inputSchema: z.object({ symbol: z.string().min(1).max(15), interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]) }),
      eager_input_streaming: true,
      run: ({ symbol, interval }) => safe(async () => {
        const pair = await binanceSymbolFor(symbol);
        if (!pair) return json({ error: `No Binance USDT market for ${symbol}; technical data unavailable.` });
        const env = await getKlines(pair, interval as BinanceInterval, 300);
        const c = env.data;
        const cl = closes(c);
        const last = (a: (number | null)[]) => r(a[a.length - 1]);
        const m = macd(cl);
        const bb = bollinger(cl);
        const recent = c.slice(-50);
        return json({
          ...meta(env), pair, interval, candles: c.length,
          lastClose: cl.at(-1), lastCandleTime: new Date((c.at(-1)?.time ?? 0) * 1000).toISOString(),
          sma20: last(sma(cl, 20)), sma50: last(sma(cl, 50)), ema21: last(ema(cl, 21)), rsi14: last(rsi(cl)),
          macd: { line: last(m.line), signal: last(m.signal), hist: last(m.hist) },
          bollinger: { upper: last(bb.upper), mid: last(bb.mid), lower: last(bb.lower) },
          vwap: last(vwap(c)), takerBuyRatio: last(buyerSellerRatio(c, 20)),
          range50: { high: Math.max(...recent.map((x) => x.high)), low: Math.min(...recent.map((x) => x.low)) },
          volumeLast: c.at(-1)?.volume, volumeAvg50: r(recent.reduce((s, x) => s + x.volume, 0) / recent.length),
        });
      }),
    }),
    betaZodTool({
      name: "search_tokens",
      description: "Search DEX tokens/pairs by name, symbol or contract address across supported chains. Returns the deepest pairs with price, liquidity, volume and chain.",
      inputSchema: z.object({ query: z.string().min(1).max(100) }),
      eager_input_streaming: true,
      run: ({ query }) => safe(async () => {
        const env = await searchPairs(query);
        return json({ ...meta(env), pairs: env.data.filter((p) => getChain(p.chain)).slice(0, 8).map((p) => ({ chain: p.chain, token: p.base, priceUsd: p.priceUsd, liquidityUsd: p.liquidityUsd, volume24h: p.volume.h24, change24h: p.change.h24, marketCap: p.marketCap, dex: p.dex })) });
      }),
    }),
    betaZodTool({
      name: "get_dex_token",
      description: "Full on-chain profile of a DEX token by chain + contract address: pairs/liquidity, buy/sell transaction counts, volume by window, holder concentration, contract security flags (GoPlus) and activity signals.",
      inputSchema: z.object({ chain: z.enum(chainIds), address: z.string().min(20).max(64) }),
      eager_input_streaming: true,
      run: ({ chain, address }) => safe(async () => {
        const c = getChain(chain)!;
        const [pairs, info, sec] = await Promise.allSettled([getTokenPairs(c.dexscreener, address), getTokenInfo(c.geckoterminal, address), getTokenSecurity(c, address)]);
        const ps = pairs.status === "fulfilled" ? pairs.value.data : [];
        const top = ps[0];
        return json({
          ...(pairs.status === "fulfilled" ? meta(pairs.value) : { pairsError: errorMessage(pairs.reason) }),
          token: top?.base ?? null,
          topPair: top ? { dex: top.dex, priceUsd: top.priceUsd, liquidityUsd: top.liquidityUsd, fdv: top.fdv, marketCap: top.marketCap, change: top.change, volume: top.volume, txns: top.txns, createdAt: top.createdAt ? new Date(top.createdAt).toISOString() : null } : null,
          pairCount: ps.length,
          totalLiquidityUsd: ps.reduce((s, p) => s + (p.liquidityUsd ?? 0), 0),
          signals: top ? poolSignals(top) : [],
          holders: info.status === "fulfilled" ? info.value.data.holders : null,
          verified: info.status === "fulfilled" ? info.value.data.verified : null,
          security: sec.status === "fulfilled" && sec.value.data
            ? { score: sec.value.data.score, level: sec.value.data.level, failedChecks: sec.value.data.flags.filter((f) => !f.ok).map((f) => `${f.label}${f.detail ? ` (${f.detail})` : ""}`), top10Pct: r(sec.value.data.top10Pct, 2) }
            : null,
        });
      }),
    }),
    betaZodTool({
      name: "get_trending_dex_pools",
      description: "Currently trending DEX pools on a network (or all networks) with price changes, volume, liquidity and automatically detected unusual-activity signals (volume spikes, buy/sell pressure, thin liquidity, fresh pools).",
      inputSchema: z.object({ network: z.enum(chainIds).optional() }),
      eager_input_streaming: true,
      run: ({ network }) => safe(async () => {
        const env = await getTrendingPools(network ? getChain(network)!.geckoterminal : undefined, "1h");
        return json({ ...meta(env), pools: env.data.filter((p) => getChain(p.network)).slice(0, 15).map((p) => ({ chain: p.network, name: p.name, token: p.base, priceUsd: p.priceUsd, change: p.change, volume: p.volume, liquidityUsd: p.reserveUsd, txns: p.txns, createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null, signals: poolSignals(p).map((s) => s.label) })) });
      }),
    }),
    betaZodTool({
      name: "get_news",
      description: "Latest crypto news headlines from CoinDesk, Cointelegraph and Decrypt, optionally filtered by keywords (e.g. ['Solana','SOL']).",
      inputSchema: z.object({ keywords: z.array(z.string().max(40)).max(4).optional() }),
      eager_input_streaming: true,
      run: ({ keywords }) => safe(async () => {
        const env = await getNews();
        const items = keywords?.length ? filterNews(env.data, keywords) : env.data;
        return json({ ...meta(env), items: items.slice(0, 12).map((n) => ({ title: n.title, source: n.source, publishedAt: new Date(n.publishedAt).toISOString(), url: n.url, summary: n.summary.slice(0, 200) })) });
      }),
    }),
    betaZodTool({
      name: "propose_watchlist",
      description: "Propose a watchlist to the user. It is NOT saved until the user confirms it in the UI. Use coin ids for listed coins (kind 'coin') or chain+address for DEX tokens (kind 'token').",
      inputSchema: z.object({
        name: z.string().max(40),
        items: z.array(z.object({ kind: z.enum(["coin", "token"]), id: z.string().max(80), label: z.string().max(40), chain: z.enum(chainIds).optional(), address: z.string().max(64).optional() })).min(1).max(20),
      }),
      eager_input_streaming: true,
      run: async (input) => {
        emit.action({ kind: "watchlist", ...input });
        return "Watchlist proposal shown to the user for confirmation.";
      },
    }),
    betaZodTool({
      name: "propose_price_alert",
      description: "Propose a price alert to the user (triggers in their browser while ShareBajar is open). Not active until the user confirms it.",
      inputSchema: z.object({
        label: z.string().max(40),
        target: z.object({ kind: z.enum(["coin", "token"]), id: z.string().max(80), chain: z.enum(chainIds).optional(), address: z.string().max(64).optional() }),
        condition: z.enum(["above", "below"]),
        price: z.number().positive(),
      }),
      eager_input_streaming: true,
      run: async (input) => {
        emit.action({ kind: "alert", ...input });
        return "Alert proposal shown to the user for confirmation.";
      },
    }),
  ];
}

export const TOOL_LABELS: Record<string, string> = {
  get_market_overview: "Reading global market data",
  get_coin: "Fetching coin data",
  get_technical_analysis: "Computing indicators from live candles",
  search_tokens: "Searching DEX markets",
  get_dex_token: "Analyzing on-chain token data",
  get_trending_dex_pools: "Scanning trending pools",
  get_news: "Reading latest news",
  propose_watchlist: "Preparing watchlist",
  propose_price_alert: "Preparing price alert",
};

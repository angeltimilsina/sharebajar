import "server-only";
import { fetchUpstream } from "../server/http";
import { priceSymbol } from "./tokens";

/**
 * Historical USD prices for revenue valuation.
 *  - USD stablecoins → 1.00 ("peg")
 *  - Majors → Binance 1-minute kline close at the transaction's block time
 *  - Others → current Jupiter (Solana) / DexScreener (EVM) price, labelled as such
 */
const BINANCE = process.env.BINANCE_REST_URL || "https://data-api.binance.vision";
const memo = new Map<string, { price: number | null; source: string }>();

export async function priceAt(chain: string, token: string, symbol: string, timeMs: number): Promise<{ price: number | null; source: string }> {
  const sym = priceSymbol(symbol);
  if (sym === "USD") return { price: 1, source: "stablecoin peg" };
  const minute = Math.floor(timeMs / 60_000) * 60_000;
  const key = `${sym}:${minute}`;
  if (memo.has(key)) return memo.get(key)!;
  let out: { price: number | null; source: string } = { price: null, source: "unavailable" };
  if (sym) {
    try {
      const k = await fetchUpstream<(string | number)[][]>(`${BINANCE}/api/v3/klines?symbol=${sym}USDT&interval=1m&startTime=${minute}&limit=1`, { retries: 0, timeoutMs: 8000 });
      if (k[0]) out = { price: Number(k[0][4]), source: `Binance ${sym}USDT 1m close @ ${new Date(Number(k[0][0])).toISOString()}` };
    } catch { /* fall through */ }
  }
  if (out.price === null) {
    try {
      if (chain === "solana") {
        const r = await fetchUpstream<Record<string, { usdPrice: number }>>(`https://lite-api.jup.ag/price/v3?ids=${token}`, { retries: 0, timeoutMs: 8000 });
        if (r[token]?.usdPrice) out = { price: r[token].usdPrice, source: "Jupiter price at indexing time (no historical feed)" };
      } else {
        const r = await fetchUpstream<{ priceUsd?: string }[]>(`https://api.dexscreener.com/tokens/v1/${chain === "bsc" ? "bsc" : chain}/${token}`, { retries: 0, timeoutMs: 8000 });
        const p = Number(r?.[0]?.priceUsd);
        if (p > 0) out = { price: p, source: "DexScreener price at indexing time (no historical feed)" };
      }
    } catch { /* unavailable */ }
  }
  memo.set(key, out);
  if (memo.size > 5000) memo.clear();
  return out;
}

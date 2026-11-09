import "server-only";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { portfolio } from "../bajar/server/portfolio";
import { binanceSymbolFor, getKlines } from "../market/binance";
import { CHAINS } from "../chains";
import { errorMessage } from "../server/cache";
import type { AiAction } from "./config";

const json = (o: unknown) => JSON.stringify(o);
const safe = (fn: () => Promise<string>) => fn().catch((e) => json({ error: errorMessage(e) }));
const chainIds = CHAINS.map((c) => c.id) as [string, ...string[]];
const STABLE = new Set(["USDC", "USDT", "DAI", "USDS", "USDE", "FDUSD", "PYUSD", "TUSD", "USDC.E", "USDBC"]);
const clean = (s: string) => s.replace(/[^A-Za-z0-9.$_-]/g, "").slice(0, 16) || "?";
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface ProWallet { address: string; chainType: "solana" | "evm" }

/**
 * Pro-only agent tools. Addresses stay on the server: the model sees wallets
 * as "Wallet 1 (Solana)" etc. Nothing here can move funds; trade ideas are
 * cards the user opens in Trade and approves in their own wallet.
 */
export function buildProTools(wallets: ProWallet[], emit: { action: (a: AiAction) => void }) {
  let cache: Promise<{ wallet: string; chain: string; totalUsd: number; holdings: { symbol: string; network: string; token: string; amount: number; valueUsd: number; priceUsd: number | null; change24h: number | null; wrappedBtc: boolean }[]; errors: string[] }[]> | null = null;
  const load = () => (cache ??= Promise.all(wallets.slice(0, 25).map(async (w, i) => {
    const env = await portfolio(w.chainType === "evm" ? { evm: w.address } : { solana: w.address }, []);
    return {
      wallet: `Wallet ${i + 1} (${w.chainType === "evm" ? "EVM" : "Solana"})`, chain: w.chainType, totalUsd: round(env.data.totalUsd),
      holdings: env.data.holdings.filter((h) => (h.usdValue ?? 0) >= 1).map((h) => ({ symbol: clean(h.wrappedBtc ? `${h.symbol}` : h.symbol), network: h.network, token: h.token, amount: h.amount, valueUsd: round(h.usdValue ?? 0), priceUsd: h.usdPrice, change24h: h.change24h ?? null, wrappedBtc: !!h.wrappedBtc })),
      errors: env.data.errors,
    };
  })));

  return [
    betaZodTool({
      name: "get_my_portfolio",
      description: "Live holdings in every wallet linked to the user's Bajar profile (read from the chains now): per wallet, each asset's network, amount, USD value, price and 24h change. Wallets are labelled 'Wallet N'. Wrapped BTC (wrappedBtc: true) is not native BTC.",
      inputSchema: z.object({}),
      eager_input_streaming: true,
      run: () => safe(async () => json({ wallets: await load(), readAt: new Date().toISOString() })),
    }),
    betaZodTool({
      name: "get_risk_report",
      description: "Risk report for the user's whole linked portfolio: concentration (largest position, top-3 share, HHI), stablecoin share, per-network exposure, and for the largest non-stable assets the 30-day annualised volatility, max drawdown and 30-day return from Binance daily candles.",
      inputSchema: z.object({}),
      eager_input_streaming: true,
      run: () => safe(async () => {
        const ws = await load();
        const merged = new Map<string, number>();
        const byNet = new Map<string, number>();
        for (const w of ws) for (const h of w.holdings) {
          const k = h.wrappedBtc ? "BTC" : h.symbol.toUpperCase();
          merged.set(k, (merged.get(k) ?? 0) + h.valueUsd);
          byNet.set(h.network, (byNet.get(h.network) ?? 0) + h.valueUsd);
        }
        const total = [...merged.values()].reduce((s, v) => s + v, 0);
        if (!total) return json({ totalUsd: 0, note: "No priced holdings in linked wallets." });
        const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1]);
        const w = sorted.map(([, v]) => v / total);
        const stable = sorted.filter(([s]) => STABLE.has(s)).reduce((s, [, v]) => s + v, 0);
        const risky = sorted.filter(([s]) => !STABLE.has(s)).slice(0, 6);
        const vol = await Promise.all(risky.map(async ([sym, value]) => {
          const pair = await binanceSymbolFor(sym);
          if (!pair) return { symbol: sym, valueUsd: round(value), note: "no Binance market" };
          const k = (await getKlines(pair, "1d", 31)).data;
          const c = k.map((x) => x.close);
          const rets = c.slice(1).map((v, i) => Math.log(v / c[i]));
          const mean = rets.reduce((s, x) => s + x, 0) / (rets.length || 1);
          const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1));
          let peak = c[0], dd = 0;
          for (const v of c) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }
          return { symbol: sym, valueUsd: round(value), pct: round((value / total) * 100, 1), annualisedVolPct: round(sd * Math.sqrt(365) * 100, 1), maxDrawdown30dPct: round(dd * 100, 1), return30dPct: round((c[c.length - 1] / c[0] - 1) * 100, 1) };
        }));
        return json({
          totalUsd: round(total), walletCount: ws.length,
          largest: { symbol: sorted[0][0], pct: round(w[0] * 100, 1) },
          top3Pct: round(w.slice(0, 3).reduce((s, x) => s + x, 0) * 100, 1),
          hhi: round(w.reduce((s, x) => s + x * x, 0), 3),
          stablecoinPct: round((stable / total) * 100, 1),
          networks: [...byNet.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ network: n, pct: round((v / total) * 100, 1) })),
          assets: vol,
        });
      }),
    }),
    betaZodTool({
      name: "propose_trade",
      description: "Show the user ONE concrete trade idea as a card with an 'Open in Trade' button. Nothing executes: the user reviews and approves it in their own wallet. Call once per step of a plan. For DEX tokens pass network and token address; for listed coins just the symbol.",
      inputSchema: z.object({
        side: z.enum(["buy", "sell"]),
        symbol: z.string().regex(/^[A-Za-z0-9.$_-]{1,16}$/),
        amountUsd: z.number().positive().max(1e9),
        network: z.enum(chainIds).optional(),
        address: z.string().max(64).optional(),
        reason: z.string().max(240),
      }),
      eager_input_streaming: true,
      run: async (input) => {
        emit.action({ kind: "trade", ...input });
        return "Trade card shown. The user decides whether to open and approve it.";
      },
    }),
  ];
}

export const PRO_TOOL_LABELS: Record<string, string> = {
  get_my_portfolio: "Reading your linked wallets",
  get_risk_report: "Measuring portfolio risk",
  propose_trade: "Drafting a trade step",
};

export const PRO_NOTE = [
  "",
  "",
  "PRO AGENT MODE. The user has Bajar Pro. You can read every wallet linked to their profile with get_my_portfolio and measure risk with get_risk_report — call them before giving portfolio advice instead of asking the user for holdings.",
  "When asked for a plan: (1) read the portfolio, (2) run the risk report, (3) explain the 2–3 biggest issues with numbers, (4) give a numbered plan and call propose_trade once per trade step (asset, side, approximate USD amount, network).",
  "You never execute or move funds. Each step opens in Bajar Trade where the user reviews and approves it in their own wallet. Never treat wrapped BTC as native BTC. Not financial advice.",
].join("\n");

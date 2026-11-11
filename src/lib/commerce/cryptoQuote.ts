import "server-only";
import { priceAt } from "@/lib/treasury/prices";

/** Payment assets and networks BAJAR Pay quotes in. */
export const PAY_ASSETS = {
  USDC: { networks: ["solana", "base", "ethereum"], decimals: 6, stable: true },
  USDT: { networks: ["ethereum", "solana"], decimals: 6, stable: true },
  ETH: { networks: ["ethereum", "base"], decimals: 18, stable: false },
  SOL: { networks: ["solana"], decimals: 9, stable: false },
  BTC: { networks: ["bitcoin"], decimals: 8, stable: false },
} as const;
export type PayAsset = keyof typeof PAY_ASSETS;

/** Typical network fee for one payment, in USD (estimate, shown as such). */
const NETWORK_FEE_USD: Record<string, number> = { solana: 0.002, base: 0.02, ethereum: 1.5, bitcoin: 1.2 };

export async function cryptoQuote(usd: number, asset: PayAsset, network?: string) {
  const a = PAY_ASSETS[asset];
  const net = network && (a.networks as readonly string[]).includes(network) ? network : a.networks[0];
  let price = 1, source = "stablecoin (1 USD)";
  if (!a.stable) {
    const p = await priceAt(net, "native", asset, Date.now());
    if (!p.price || !p.source.startsWith("Binance")) throw new Error(`No live ${asset} price right now.`);
    price = p.price; source = p.source;
  }
  const amount = usd / price;
  return { asset, network: net, usd, priceUsd: price, amount: Number(amount.toFixed(Math.min(a.decimals, 8))), networkFeeUsd: NETWORK_FEE_USD[net] ?? 0.5, priceSource: source, at: Date.now() };
}

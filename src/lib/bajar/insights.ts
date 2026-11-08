/**
 * Wallet insights: plain observations computed from the user's real balances.
 * No predictions and no advice — just things worth knowing or doing next.
 */
export interface InsightHolding {
  network: string; networkName: string; token: string; symbol: string;
  amount: number; usdValue: number | null; usdPrice: number | null;
  native: boolean; wrappedBtc?: boolean; change24h?: number | null;
}

export type InsightAction = "receive" | "send" | "swap" | "settings";
export interface WalletInsight {
  id: string;
  tone: "warn" | "info" | "up" | "down";
  title: string;
  body: string;
  action?: { label: string; to: InsightAction };
}

const GAS: Record<string, string> = { ethereum: "ETH", base: "ETH", arbitrum: "ETH", optimism: "ETH", polygon: "POL", bsc: "BNB", avalanche: "AVAX", solana: "SOL" };
const STABLES = new Set(["USDC", "USDT", "DAI", "USDS", "USDE", "FDUSD", "PYUSD", "USDC.E", "USDBC", "TUSD"]);
const usd = (v: number) => (Math.abs(v) >= 1000 ? `$${Math.round(v).toLocaleString("en-US")}` : `$${v.toFixed(2)}`);

/** Portfolio 24h change in USD and %, from holdings that have a known 24h change. */
export function dayChange(hs: InsightHolding[]): { usd: number; pct: number | null; coverage: number } {
  let now = 0, before = 0, covered = 0, total = 0;
  for (const h of hs) {
    const v = h.usdValue ?? 0;
    total += v;
    if (h.change24h === null || h.change24h === undefined || !v) continue;
    covered += v;
    now += v;
    before += v / (1 + h.change24h / 100);
  }
  return { usd: now - before, pct: before ? ((now - before) / before) * 100 : null, coverage: total ? covered / total : 0 };
}

export interface Slice { key: string; label: string; value: number; pct: number }

/** Allocation by asset (merging the same symbol across networks) or by network. Top 5 + Other. */
export function allocation(hs: InsightHolding[], by: "asset" | "network"): Slice[] {
  const m = new Map<string, { label: string; value: number }>();
  for (const h of hs) {
    if (!h.usdValue || h.usdValue < 0.01) continue; // ignore dust
    const key = by === "asset" ? (h.wrappedBtc ? `${h.symbol} (wrapped)` : h.symbol.toUpperCase()) : h.network;
    const cur = m.get(key) ?? { label: by === "asset" ? key : h.networkName, value: 0 };
    cur.value += h.usdValue;
    m.set(key, cur);
  }
  const total = [...m.values()].reduce((s, x) => s + x.value, 0);
  if (!total) return [];
  const sorted = [...m.entries()].map(([key, x]) => ({ key, label: x.label, value: x.value, pct: (x.value / total) * 100 })).sort((a, b) => b.value - a.value);
  if (sorted.length <= 6) return sorted;
  const other = sorted.slice(5).reduce((s, x) => s + x.value, 0);
  return [...sorted.slice(0, 5), { key: "other", label: "Other", value: other, pct: (other / total) * 100 }];
}

export function walletInsights(hs: InsightHolding[], opts: { backedUp: boolean; loaded: boolean }): WalletInsight[] {
  const out: WalletInsight[] = [];
  const held = hs.filter((h) => h.amount > 0);
  const total = held.reduce((s, h) => s + (h.usdValue ?? 0), 0);

  if (!opts.backedUp) out.push({ id: "backup", tone: "warn", title: "Back up your wallet", body: "Without a backup, losing this browser means losing your funds.", action: { label: "Back up now", to: "settings" } });
  if (!opts.loaded) return out;

  if (!held.length) {
    out.push({ id: "fund", tone: "info", title: "Add funds to get started", body: "Copy your Bitcoin, EVM or Solana address and send assets from an exchange or another wallet.", action: { label: "Show my addresses", to: "receive" } });
    return out;
  }

  // Tokens you can't move without the network's fee token.
  for (const [net, gas] of Object.entries(GAS)) {
    const tokens = held.filter((h) => h.network === net && !h.native && (h.usdValue ?? 0) >= 1);
    const hasGas = held.some((h) => h.network === net && h.native && h.amount > 0);
    if (tokens.length && !hasGas) {
      const name = tokens[0].networkName;
      out.push({ id: `gas:${net}`, tone: "warn", title: `No ${gas} for fees on ${name}`, body: `You hold ${tokens.map((t) => t.symbol).slice(0, 3).join(", ")} on ${name} but no ${gas} to pay network fees, so it can't be sent or swapped yet.`, action: { label: `Receive ${gas}`, to: "receive" } });
    }
  }

  // Today's biggest move on a meaningful position.
  const movers = held.filter((h) => (h.usdValue ?? 0) >= 1 && h.change24h !== null && h.change24h !== undefined && !STABLES.has(h.symbol.toUpperCase()))
    .map((h) => ({ h, delta: (h.usdValue ?? 0) - (h.usdValue ?? 0) / (1 + (h.change24h ?? 0) / 100) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  if (movers[0] && Math.abs(movers[0].h.change24h ?? 0) >= 2) {
    const { h, delta } = movers[0];
    const up = (h.change24h ?? 0) >= 0;
    out.push({ id: "mover", tone: up ? "up" : "down", title: `${h.symbol} is ${up ? "up" : "down"} ${Math.abs(h.change24h ?? 0).toFixed(1)}% today`, body: `That's ${up ? "+" : "−"}${usd(Math.abs(delta))} on your ${h.symbol} position over 24 hours.` });
  }

  if (total >= 10) {
    const top = allocation(held, "asset")[0];
    if (top && top.pct >= 70 && !STABLES.has(top.key)) out.push({ id: "concentration", tone: "info", title: `${top.pct.toFixed(0)}% of your portfolio is ${top.label}`, body: `Your balance moves almost entirely with ${top.label}. That's a choice worth making on purpose.`, action: { label: "Swap", to: "swap" } });
    const stable = held.filter((h) => STABLES.has(h.symbol.toUpperCase())).reduce((s, h) => s + (h.usdValue ?? 0), 0);
    if (stable > 0 && stable / total < 0.98) out.push({ id: "stables", tone: "info", title: `${((stable / total) * 100).toFixed(0)}% in stablecoins`, body: `${usd(stable)} is held in dollar-pegged tokens, which don't move with the market.` });
  }

  if (held.some((h) => h.wrappedBtc)) out.push({ id: "wrapped", tone: "info", title: "You hold wrapped BTC", body: "Wrapped BTC is a token on another network backed by a custodian or bridge. It tracks BTC's price but is not native bitcoin." });

  const unpriced = held.filter((h) => h.usdPrice === null);
  if (unpriced.length) out.push({ id: "unpriced", tone: "info", title: `${unpriced.length} token${unpriced.length > 1 ? "s" : ""} not valued`, body: `${unpriced.map((h) => h.symbol).slice(0, 4).join(", ")} ha${unpriced.length > 1 ? "ve" : "s"} no reliable market price, so ${unpriced.length > 1 ? "they're" : "it's"} not counted in your total.` });

  return out;
}

/** Where tapping a holding should go: the asset's page on Bajar, if there is one. */
export function assetHref(h: Pick<InsightHolding, "network" | "token" | "symbol" | "native">): string | null {
  const coin: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana" };
  if (h.network === "bitcoin") return "/coin/bitcoin";
  if (h.native || (h.network === "solana" && h.symbol === "SOL")) return coin[h.symbol.toUpperCase()] ? `/coin/${coin[h.symbol.toUpperCase()]}` : null;
  return `/token/${h.network}/${h.token}`;
}

import "server-only";
import { cached } from "../../server/cache";
import { CHAINS, getChain } from "../../chains";
import { KNOWN_TOKENS, NATIVE_EVM, WSOL } from "../../treasury/tokens";
import { erpc, hexToBig, pad32 } from "../../treasury/evm";
import { ata, srpc, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "../../treasury/solana";
import { priceAt } from "../../treasury/prices";
import { btcSummary } from "./bitcoin";
import { get24hTickers } from "../../market/binance";

/**
 * Multi-chain holdings for public addresses (no keys involved). Every number is
 * read from the chain at request time; prices are live, with the source shown.
 */
export interface Holding {
  network: string; networkName: string; token: string; symbol: string; name: string; decimals: number;
  amountRaw: string; amount: number; usdPrice: number | null; usdValue: number | null; priceSource: string;
  native: boolean; wrappedBtc?: boolean; custom?: boolean;
  /** 24h price change in %, from the same Binance market as the price (null when not available). */
  change24h?: number | null;
}

export interface CustomToken { network: string; token: string; symbol: string; decimals: number }

const WRAPPED_BTC = new Set(["WBTC", "CBBTC", "TBTC", "BTCB", "BTC.B"]);
const EXTRA: Record<string, { token: string; symbol: string; decimals: number }[]> = {
  ethereum: [{ token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", decimals: 8 }],
  base: [{ token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", symbol: "cbBTC", decimals: 8 }],
  arbitrum: [{ token: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", symbol: "WBTC", decimals: 8 }],
};

async function evmHoldings(address: string, custom: CustomToken[]): Promise<Holding[]> {
  const out: Holding[] = [];
  await Promise.all(CHAINS.filter((c) => c.type === "evm").map(async (c) => {
    const tokens = [...(KNOWN_TOKENS[c.id] ?? []), ...(EXTRA[c.id] ?? []), ...custom.filter((t) => t.network === c.id)];
    try {
      const calls = [{ method: "eth_getBalance", params: [address, "latest"] }, ...tokens.map((t) => ({ method: "eth_call", params: [{ to: t.token, data: `0x70a08231${pad32(address).slice(2)}` }, "latest"] }))];
      // one JSON-RPC batch per chain
      const res = await Promise.all(calls.map((cl) => erpc<string>(c.id, cl.method, cl.params).catch(() => "0x0")));
      const push = (token: string, symbol: string, decimals: number, raw: bigint, native: boolean, isCustom = false) => {
        if (raw === BigInt(0) && !native && !isCustom) return;
        out.push({ network: c.id, networkName: c.name, token, symbol, name: symbol, decimals, amountRaw: raw.toString(), amount: Number(raw) / 10 ** decimals, usdPrice: null, usdValue: null, priceSource: "", native, wrappedBtc: WRAPPED_BTC.has(symbol.toUpperCase()), custom: isCustom });
      };
      push(NATIVE_EVM, c.nativeSymbol, 18, hexToBig(res[0]), true);
      tokens.forEach((t, i) => push(t.token, t.symbol, t.decimals, hexToBig(res[i + 1] || "0x0"), false, custom.some((x) => x.token === t.token)));
    } catch { /* chain unavailable: omitted, reported below */ }
  }));
  return out;
}

async function solanaHoldings(address: string, custom: CustomToken[]): Promise<Holding[]> {
  const out: Holding[] = [];
  const sol = await srpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]);
  out.push({ network: "solana", networkName: "Solana", token: WSOL, symbol: "SOL", name: "Solana", decimals: 9, amountRaw: String(sol.value), amount: sol.value / 1e9, usdPrice: null, usdValue: null, priceSource: "", native: true });
  const mints = [...KNOWN_TOKENS.solana.filter((t) => t.token !== WSOL), ...custom.filter((t) => t.network === "solana")];
  const keys = mints.flatMap((m) => [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((p) => ({ m, account: ata(address, m.token, p) })));
  if (keys.length) {
    const r = await srpc<{ value: ({ data: { parsed?: { info: { tokenAmount: { amount: string; decimals: number } } } } } | null)[] }>("getMultipleAccounts", [keys.map((k) => k.account), { encoding: "jsonParsed" }]);
    r.value.forEach((acc, i) => {
      const info = acc?.data?.parsed?.info;
      if (!info) return;
      const m = keys[i].m;
      out.push({ network: "solana", networkName: "Solana", token: m.token, symbol: m.symbol, name: m.symbol, decimals: info.tokenAmount.decimals, amountRaw: info.tokenAmount.amount, amount: Number(info.tokenAmount.amount) / 10 ** info.tokenAmount.decimals, usdPrice: null, usdValue: null, priceSource: "", native: false, custom: custom.some((x) => x.token === m.token) });
    });
  }
  return out;
}

export async function portfolio(addrs: { btc?: string; evm?: string; solana?: string }, custom: CustomToken[]) {
  const key = `pf:${addrs.btc}:${addrs.evm}:${addrs.solana}:${custom.map((c) => c.network + c.token).sort().join(",")}`;
  return cached(key, "On-chain RPC + mempool.space", { ttlMs: 15_000, staleMs: 5 * 60_000 }, async () => {
    const errors: string[] = [];
    const parts = await Promise.allSettled([
      addrs.btc ? btcSummary(addrs.btc).then((s): Holding[] => [{ network: "bitcoin", networkName: "Bitcoin", token: "BTC", symbol: "BTC", name: "Bitcoin (native)", decimals: 8, amountRaw: String(s.data.confirmedSats + s.data.pendingSats), amount: (s.data.confirmedSats + s.data.pendingSats) / 1e8, usdPrice: null, usdValue: null, priceSource: "", native: true }]) : Promise.resolve([]),
      addrs.evm ? evmHoldings(addrs.evm, custom) : Promise.resolve([]),
      addrs.solana ? solanaHoldings(addrs.solana, custom) : Promise.resolve([]),
    ]);
    const holdings: Holding[] = [];
    parts.forEach((p, i) => { if (p.status === "fulfilled") holdings.push(...p.value); else errors.push(`${["Bitcoin", "EVM", "Solana"][i]}: ${String(p.reason).slice(0, 120)}`); });
    const now = Date.now();
    await Promise.all(holdings.map(async (h) => {
      const sym = h.wrappedBtc ? "BTC" : h.symbol;
      const p = await priceAt(h.network === "bitcoin" ? "bitcoin" : h.network, h.token, sym, now);
      h.usdPrice = p.price;
      h.usdValue = p.price === null ? null : h.amount * p.price;
      h.priceSource = h.wrappedBtc && p.price !== null ? `${p.source} (wrapped BTC tracks BTC; not native BTC)` : p.source;
    }));
    // 24h change from the Binance market that priced the asset; stablecoins are flat by definition.
    const pairOf = (h: Holding) => /^Binance ([A-Z0-9]+USDT) /.exec(h.priceSource)?.[1];
    const pairs = [...new Set(holdings.map(pairOf).filter((x): x is string => !!x))].sort();
    let changes = new Map<string, number>();
    if (pairs.length) {
      try { changes = new Map((await get24hTickers(pairs)).data.map((t) => [t.symbol, t.change24h])); } catch { /* change unavailable */ }
    }
    for (const h of holdings) {
      const pair = pairOf(h);
      h.change24h = h.priceSource === "stablecoin peg" ? 0 : pair && changes.has(pair) ? changes.get(pair)! : null;
    }
    holdings.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
    return { holdings, totalUsd: holdings.reduce((s, h) => s + (h.usdValue ?? 0), 0), errors, networks: ["bitcoin", ...CHAINS.map((c) => c.id)].filter((n) => n === "bitcoin" || getChain(n)) };
  });
}

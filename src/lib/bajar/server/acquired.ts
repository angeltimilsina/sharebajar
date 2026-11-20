import "server-only";
import { cached } from "../../server/cache";
import { fetchUpstream } from "../../server/http";
import { ata, srpc, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "../../treasury/solana";
import { NATIVE_EVM, WSOL } from "../../treasury/tokens";
import { priceAt } from "../../treasury/prices";

/**
 * When a wallet first received an asset, read from public on-chain history.
 * This is the first incoming transfer, not a cost basis: a transfer between
 * your own wallets counts too. `bound` is "onOrBefore" when the history was
 * longer than we page through (the real date is that day or earlier).
 */
export interface Acquired {
  time: number | null;
  bound: "exact" | "onOrBefore" | "unavailable";
  source: string;
  /** Market price on that date, only from a historical feed (Binance 1m close or stablecoin peg). */
  priceThen: number | null;
  priceSource: string | null;
}

const MEMPOOL = process.env.MEMPOOL_API_URL || "https://mempool.space/api";
/** Public Blockscout explorers (keyless, Etherscan-compatible API). */
const BLOCKSCOUT: Record<string, string> = {
  ethereum: "https://eth.blockscout.com",
  base: "https://base.blockscout.com",
  optimism: "https://optimism.blockscout.com",
  arbitrum: "https://arbitrum.blockscout.com",
  polygon: "https://polygon.blockscout.com",
};
const SOL_PAGES = 3;

async function oldestSignature(account: string): Promise<{ time: number | null; complete: boolean }> {
  let before: string | undefined;
  let oldest: number | null = null;
  for (let i = 0; i < SOL_PAGES; i++) {
    const page = await srpc<{ signature: string; blockTime: number | null }[]>("getSignaturesForAddress", [account, { limit: 1000, ...(before ? { before } : {}) }]);
    if (!page.length) return { time: oldest, complete: true };
    const last = page[page.length - 1];
    for (let j = page.length - 1; j >= 0; j--) if (page[j].blockTime) { oldest = page[j].blockTime! * 1000; break; }
    if (page.length < 1000) return { time: oldest, complete: true };
    before = last.signature;
  }
  return { time: oldest, complete: false };
}

async function solana(address: string, token: string): Promise<Omit<Acquired, "priceThen" | "priceSource">> {
  if (token === WSOL || token === "native") {
    const r = await oldestSignature(address);
    return { time: r.time, bound: r.time === null ? "unavailable" : r.complete ? "exact" : "onOrBefore", source: "Solana RPC · first wallet transaction" };
  }
  // The token account(s) for this mint: created when the token first arrived.
  // Associated token accounts are derived, so no indexed RPC call is needed.
  let best: { time: number | null; complete: boolean } = { time: null, complete: true };
  for (const program of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const r = await oldestSignature(ata(address, token, program));
    if (r.time !== null && (best.time === null || r.time < best.time)) best = r;
  }
  if (best.time === null) {
    // Tokens held outside the associated account: needs the indexed lookup (some nodes refuse it).
    try {
      const accs = await srpc<{ value: { pubkey: string }[] }>("getTokenAccountsByOwner", [address, { mint: token }, { encoding: "jsonParsed" }]);
      for (const a of accs.value.slice(0, 3)) {
        const r = await oldestSignature(a.pubkey);
        if (r.time !== null && (best.time === null || r.time < best.time)) best = r;
      }
    } catch { /* not indexed on this node */ }
  }
  return { time: best.time, bound: best.time === null ? "unavailable" : best.complete ? "exact" : "onOrBefore", source: "Solana RPC · token account history" };
}

interface ScanTx { timeStamp: string; to: string; value?: string; isError?: string }
async function evm(network: string, address: string, token: string): Promise<Omit<Acquired, "priceThen" | "priceSource">> {
  const host = BLOCKSCOUT[network];
  if (!host) return { time: null, bound: "unavailable", source: "No public history index for this network yet" };
  const q = (action: string, extra = "") => fetchUpstream<{ status: string; result: ScanTx[] | string }>(`${host}/api?module=account&action=${action}&address=${address}${extra}&sort=asc&page=1&offset=25`, { retries: 0, timeoutMs: 10_000 });
  const me = address.toLowerCase();
  const firstIn = (r: { result: ScanTx[] | string }, needValue: boolean) => {
    if (!Array.isArray(r.result)) return null;
    const t = r.result.find((x) => x.to?.toLowerCase() === me && x.isError !== "1" && (!needValue || BigInt(x.value ?? "0") > BigInt(0)));
    return t ? Number(t.timeStamp) * 1000 : null;
  };
  let time: number | null;
  if (token.toLowerCase() === NATIVE_EVM.toLowerCase() || token === "native") {
    const [normal, internal] = await Promise.all([q("txlist").catch(() => ({ result: [] })), q("txlistinternal").catch(() => ({ result: [] }))]);
    const ts = [firstIn(normal, true), firstIn(internal, true)].filter((x): x is number => x !== null);
    time = ts.length ? Math.min(...ts) : null;
  } else {
    time = firstIn(await q("tokentx", `&contractaddress=${token}`), false);
  }
  return { time, bound: time === null ? "unavailable" : "exact", source: `Blockscout (${new URL(host).hostname}) · first incoming transfer` };
}

async function bitcoin(address: string): Promise<Omit<Acquired, "priceThen" | "priceSource">> {
  // Oldest coins still held: the earliest confirmed unspent output.
  let utxos: { status: { confirmed: boolean; block_time?: number } }[];
  try {
    utxos = await fetchUpstream(`${MEMPOOL}/address/${address}/utxo`, { retries: 0, timeoutMs: 10_000 });
  } catch {
    return { time: null, bound: "unavailable", source: "mempool.space · address too large to index" };
  }
  const ts = utxos.filter((u) => u.status.confirmed && u.status.block_time).map((u) => u.status.block_time! * 1000);
  return { time: ts.length ? Math.min(...ts) : null, bound: ts.length ? "exact" : "unavailable", source: "mempool.space · oldest coins still held" };
}

export async function acquired(chain: "solana" | "evm" | "bitcoin", network: string, address: string, token: string, symbol: string): Promise<Acquired> {
  const env = await cached(`acq:${chain}:${network}:${address}:${token}`, "on-chain history", { ttlMs: 60 * 60_000, staleMs: 24 * 60 * 60_000 }, async () => {
    const base = chain === "solana" ? await solana(address, token) : chain === "bitcoin" ? await bitcoin(address) : await evm(network, address, token);
    let priceThen: number | null = null, priceSource: string | null = null;
    if (base.time !== null) {
      const p = await priceAt(network, token, symbol, base.time);
      // Only true historical prices; the fallbacks are today's price and would mislead.
      if (p.price !== null && (p.source.startsWith("Binance") || p.source === "stablecoin peg")) { priceThen = p.price; priceSource = p.source; }
    }
    return { ...base, priceThen, priceSource };
  });
  return env.data;
}

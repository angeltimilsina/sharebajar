import "server-only";
import { cached } from "../server/cache";
import { fetchUpstream } from "../server/http";
import { CHAINS, PRIMARY_CHAIN_IDS, type ChainInfo } from "../chains";

/**
 * Live network conditions read directly from each blockchain:
 *  - Bitcoin: mempool.space (block height, fees, mempool size)
 *  - EVM chains: JSON-RPC (latest block, gas price, txs per block)
 *  - Solana: JSON-RPC performance samples (slot, TPS)
 */
export interface NetworkStat {
  id: string;            // "bitcoin" or a Bajar chain id
  name: string;
  symbol: string;        // native asset
  pair: string;          // Binance pair for native asset price
  height: number | null; // block height / slot
  blockTime: number | null; // unix ms of latest block
  fee: { value: number; unit: string; label: string } | null;
  throughput: { value: number; unit: string } | null;
  pending: number | null; // e.g. Bitcoin mempool tx count
  source: string;
  error?: string;
}

const MEMPOOL = "https://mempool.space/api";

async function bitcoin(): Promise<NetworkStat> {
  const base: NetworkStat = { id: "bitcoin", name: "Bitcoin", symbol: "BTC", pair: "BTCUSDT", height: null, blockTime: null, fee: null, throughput: null, pending: null, source: "mempool.space" };
  const [blocks, fees, mempool] = await Promise.all([
    fetchUpstream<{ height: number; timestamp: number; tx_count: number }[]>(`${MEMPOOL}/blocks`),
    fetchUpstream<{ fastestFee: number; halfHourFee: number }>(`${MEMPOOL}/v1/fees/recommended`),
    fetchUpstream<{ count: number }>(`${MEMPOOL}/mempool`),
  ]);
  const tip = blocks[0];
  return {
    ...base, height: tip?.height ?? null, blockTime: tip ? tip.timestamp * 1000 : null,
    fee: { value: fees.fastestFee, unit: "sat/vB", label: "Fee" },
    throughput: tip ? { value: tip.tx_count, unit: "txs/block" } : null,
    pending: mempool.count,
  };
}

interface RpcRes<T> { id: number; result?: T; error?: { message: string } }
const rpcBatch = <T extends unknown[]>(url: string, calls: { method: string; params: unknown[] }[]) =>
  fetchUpstream<RpcRes<unknown>[]>(url, { method: "POST", body: calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, ...c })), timeoutMs: 8000, retries: 0 })
    .then((r) => [...r].sort((a, b) => a.id - b.id).map((x) => { if (x.error) throw new Error(x.error.message); return x.result; }) as T);

async function evm(c: ChainInfo): Promise<NetworkStat> {
  const [gas, block] = await rpcBatch<[string, { number: string; timestamp: string; transactions: string[]; baseFeePerGas?: string }]>(c.rpc, [
    { method: "eth_gasPrice", params: [] },
    { method: "eth_getBlockByNumber", params: ["latest", false] },
  ]);
  const gwei = Number(BigInt(gas)) / 1e9;
  return {
    id: c.id, name: c.name, symbol: c.nativeSymbol, pair: c.nativePair,
    height: Number(BigInt(block.number)), blockTime: Number(BigInt(block.timestamp)) * 1000,
    fee: { value: gwei, unit: "gwei", label: "Gas" },
    throughput: { value: block.transactions.length, unit: "txs/block" },
    pending: null, source: "JSON-RPC",
  };
}

async function solana(c: ChainInfo): Promise<NetworkStat> {
  const [samples, fees] = await rpcBatch<[{ numTransactions: number; numNonVoteTransactions?: number; samplePeriodSecs: number; slot: number }[], { prioritizationFee: number }[]]>(c.rpc, [
    { method: "getRecentPerformanceSamples", params: [4] },
    { method: "getRecentPrioritizationFees", params: [] },
  ]);
  const s = samples[0];
  const tx = samples.reduce((a, x) => a + (x.numNonVoteTransactions ?? x.numTransactions), 0);
  const secs = samples.reduce((a, x) => a + x.samplePeriodSecs, 0);
  const nonZero = fees.map((f) => f.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b);
  const median = nonZero.length ? nonZero[Math.floor(nonZero.length / 2)] : 0;
  return {
    id: c.id, name: c.name, symbol: "SOL", pair: c.nativePair,
    height: s?.slot ?? null, blockTime: Date.now(),
    fee: { value: median, unit: "µL/CU", label: "Priority fee" },
    throughput: secs ? { value: Math.round(tx / secs), unit: "TPS" } : null,
    pending: null, source: "JSON-RPC",
  };
}

const SHOWN = ["bitcoin", ...PRIMARY_CHAIN_IDS, "avalanche", "optimism"];

export function getNetworkStats() {
  return cached("networks:all", "On-chain RPC", { ttlMs: 12_000, staleMs: 5 * 60_000 }, async () => {
    const jobs = SHOWN.map(async (id): Promise<NetworkStat> => {
      const c = CHAINS.find((x) => x.id === id);
      try {
        if (id === "bitcoin") return await bitcoin();
        if (!c) throw new Error("unknown chain");
        return c.type === "solana" ? await solana(c) : await evm(c);
      } catch (e) {
        return { id, name: c?.name ?? "Bitcoin", symbol: c?.nativeSymbol ?? "BTC", pair: c?.nativePair ?? "BTCUSDT", height: null, blockTime: null, fee: null, throughput: null, pending: null, source: id === "bitcoin" ? "mempool.space" : "JSON-RPC", error: e instanceof Error ? e.message.slice(0, 120) : String(e) };
      }
    });
    const out = await Promise.all(jobs);
    if (out.every((n) => n.error)) throw new Error("All network RPCs unavailable");
    return out;
  });
}

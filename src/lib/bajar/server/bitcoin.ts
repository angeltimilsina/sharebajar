import "server-only";
import { fetchUpstream } from "../../server/http";
import { cached } from "../../server/cache";

/** Bitcoin network access via mempool.space (public, keyless). */
const MEMPOOL = process.env.MEMPOOL_API_URL || "https://mempool.space/api";

export interface BtcTx { txid: string; time: number | null; confirmed: boolean; blockHeight: number | null; fee: number; delta: number; vsize: number }

interface MTx { txid: string; fee: number; weight: number; status: { confirmed: boolean; block_height?: number; block_time?: number }; vin: { prevout: { scriptpubkey_address?: string; value: number } | null }[]; vout: { scriptpubkey_address?: string; value: number }[] }

export const isMainnetBtcAddress = (a: string) => /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a);

export function btcSummary(address: string) {
  return cached(`btc:sum:${address}`, "mempool.space", { ttlMs: 15_000, staleMs: 10 * 60_000 }, async () => {
    const [info, txs] = await Promise.all([
      fetchUpstream<{ chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }; mempool_stats: { funded_txo_sum: number; spent_txo_sum: number } }>(`${MEMPOOL}/address/${address}`),
      fetchUpstream<MTx[]>(`${MEMPOOL}/address/${address}/txs`),
    ]);
    const confirmed = info.chain_stats.funded_txo_sum - info.chain_stats.spent_txo_sum;
    const pending = info.mempool_stats.funded_txo_sum - info.mempool_stats.spent_txo_sum;
    return {
      confirmedSats: confirmed, pendingSats: pending, txCount: info.chain_stats.tx_count,
      txs: txs.slice(0, 25).map((t): BtcTx => ({
        txid: t.txid, time: t.status.block_time ? t.status.block_time * 1000 : null, confirmed: t.status.confirmed, blockHeight: t.status.block_height ?? null, fee: t.fee, vsize: Math.ceil(t.weight / 4),
        delta: t.vout.filter((o) => o.scriptpubkey_address === address).reduce((s, o) => s + o.value, 0) - t.vin.filter((i) => i.prevout?.scriptpubkey_address === address).reduce((s, i) => s + (i.prevout?.value ?? 0), 0),
      })),
    };
  });
}

export const btcUtxos = (address: string) =>
  fetchUpstream<{ txid: string; vout: number; value: number; status: { confirmed: boolean } }[]>(`${MEMPOOL}/address/${address}/utxo`);

export const btcFees = () => cached("btc:fees", "mempool.space", { ttlMs: 20_000 }, () =>
  fetchUpstream<{ fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number; minimumFee: number }>(`${MEMPOOL}/v1/fees/recommended`));

export async function btcBroadcast(hex: string): Promise<string> {
  if (!/^[0-9a-f]{120,200000}$/i.test(hex)) throw new Error("Invalid raw transaction");
  return fetchUpstream<string>(`${MEMPOOL}/tx`, { method: "POST", text: true, headers: { "content-type": "text/plain" }, rawBody: hex, retries: 0 });
}

export const btcTxStatus = (txid: string) => fetchUpstream<{ confirmed: boolean; block_height?: number; block_time?: number }>(`${MEMPOOL}/tx/${txid}/status`);

import "server-only";
import { verifyBitcoinMessage } from "../../bajar/btc";
import { fetchUpstream } from "../../server/http";
import type { Treasury } from "../store";
import type { TreasuryAdapter } from "./types";

const MEMPOOL = process.env.MEMPOOL_API_URL || "https://mempool.space/api";
const MAINNET = /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/;

export function btcScriptType(address: string): "p2wpkh" | "p2wsh" | "p2tr" | "p2sh" | "p2pkh" | "unknown" {
  if (/^bc1q[02-9ac-hj-np-z]{38}$/.test(address)) return "p2wpkh";
  if (/^bc1q[02-9ac-hj-np-z]{58}$/.test(address)) return "p2wsh";
  if (/^bc1p/.test(address)) return "p2tr";
  if (address.startsWith("3")) return "p2sh";
  if (address.startsWith("1")) return "p2pkh";
  return "unknown";
}

/**
 * Bitcoin treasury (native BTC). Receives LI.FI cross-chain fees on BTC-source
 * routes. Multisig (P2WSH / P2SH descriptor wallets, e.g. Sparrow, Nunchuk,
 * Casa) is strongly recommended; Bajar only watches the address and
 * prepares unsigned PSBTs — it never holds keys.
 */
export const bitcoinAdapter: TreasuryAdapter = {
  chainType: "bitcoin",
  kinds: ["wallet"],
  validAddress: (a) => MAINNET.test(a),
  async inspect({ address, environment }) {
    const warnings: string[] = [], errors: string[] = [];
    if (environment !== "mainnet") errors.push("Bitcoin treasuries are mainnet-only in this release.");
    if (!MAINNET.test(address)) errors.push("Not a valid mainnet Bitcoin address.");
    const type = btcScriptType(address);
    let info: { chain_stats: { tx_count: number; funded_txo_sum: number; spent_txo_sum: number } } | null = null;
    if (!errors.length) {
      try { info = await fetchUpstream(`${MEMPOOL}/address/${address}`); } catch (e) { errors.push(`mempool.space lookup failed: ${(e as Error).message}`); }
    }
    if (type === "p2wpkh" || type === "p2pkh") warnings.push("Single-key address. A multisig wallet (P2WSH / P2SH descriptor) is strongly recommended for treasury funds.");
    if (type === "p2wsh" || type === "p2sh" || type === "p2tr") warnings.push("Script address: ownership proof requires BIP-322 signing, which Bajar does not verify yet — use a BIP-137-capable signer key from the same wallet, or keep this treasury in monitor-only mode.");
    return {
      ok: errors.length === 0, receivingAddress: address, warnings, errors,
      facts: { scriptType: type, txCount: info?.chain_stats.tx_count ?? null, balanceSats: info ? info.chain_stats.funded_txo_sum - info.chain_stats.spent_txo_sum : null, source: "mempool.space" },
    };
  },
  async verifyOwnership(t: Treasury, signer: string, message: string, signature: string) {
    const type = btcScriptType(t.address);
    if (signer !== t.address) return { ok: false, method: "bip137", detail: "The signing address must be the treasury address." };
    if (type !== "p2wpkh" && type !== "p2pkh") return { ok: false, method: "bip322", detail: "BIP-322 (script/multisig) message verification is not supported yet." };
    const ok = verifyBitcoinMessage(t.address, message, signature);
    return { ok, method: "bip137", detail: ok ? "BIP-137 signature verified for the treasury address." : "Invalid BIP-137 signature." };
  },
  async tokenInfo(_chain, token) {
    return token === "bitcoin" || token === "BTC" ? { symbol: "BTC", decimals: 8 } : null;
  },
  feeAccount: (t) => t.address,
  async checkFeeAccounts(t) {
    return [{ token: "bitcoin", account: t.address, initialized: true, detail: "Native BTC — no account setup needed." }];
  },
  async balances(t) {
    const info = await fetchUpstream<{ chain_stats: { funded_txo_sum: number; spent_txo_sum: number }; mempool_stats: { funded_txo_sum: number; spent_txo_sum: number } }>(`${MEMPOOL}/address/${t.address}`);
    const sats = info.chain_stats.funded_txo_sum - info.chain_stats.spent_txo_sum;
    return [{ token: "bitcoin", symbol: "BTC", decimals: 8, amountRaw: String(sats), account: t.address, native: true }];
  },
};

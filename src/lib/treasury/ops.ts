import "server-only";
import { PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getChain } from "../chains";
import { assembleBuild, v2Build } from "../trading/jupiterV2";
import { zeroXQuote } from "../trading/zerox";
import { ata, createAtaIdempotentIx, mintInfo, srpc, TOKEN_PROGRAM } from "./solana";
import { encodeErc20Approve, encodeErc20Transfer, erpc, hexToBig } from "./evm";
import { KNOWN_TOKENS, NATIVE_EVM, sameToken, WSOL, ZEROX_CHAINS } from "./tokens";
import { getTreasury, type Treasury } from "./store";
import { TreasuryError } from "./http";

/**
 * Outgoing treasury operations. These functions ONLY build and simulate
 * unsigned transactions. Execution always requires the treasury wallet or
 * multisig signers to approve in their own wallet / Safe / Squads app.
 */
export type OpResult =
  | { kind: "solana-tx"; signer: string; transaction: string; simulation: { err: unknown; unitsConsumed?: number | null; logs?: string[] | null }; summary: string }
  | { kind: "evm-txs"; signer: string; chainId: number; transactions: { to: string; data: string; value: string; label: string }[]; simulation: { ok: boolean; detail: string }; summary: string }
  | { kind: "safe-batch"; safe: string; chainId: number; batch: unknown; simulation: { ok: boolean; detail: string }; summary: string }
  | { kind: "squads-instructions"; multisig: string; vault: string; instructions: unknown[]; simulation: { ok: boolean; detail: string }; summary: string };

const toRaw = (amount: string, decimals: number): bigint => {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new TreasuryError(400, "Invalid amount");
  const [i, f = ""] = amount.split(".");
  if (f.length > decimals) throw new TreasuryError(400, `Too many decimals (max ${decimals})`);
  const raw = BigInt(i + f.padEnd(decimals, "0"));
  if (raw <= BigInt(0)) throw new TreasuryError(400, "Amount must be positive");
  return raw;
};

async function tokenMeta(t: Treasury, token: string): Promise<{ symbol: string; decimals: number; tokenProgram?: string }> {
  if (t.chainType === "solana") {
    if (token === WSOL) return { symbol: "SOL", decimals: 9 };
    const m = await mintInfo(token);
    if (!m) throw new TreasuryError(400, "Unknown SPL mint");
    const k = KNOWN_TOKENS.solana.find((x) => x.token === token) ?? t.feeConfig?.tokens.find((x) => x.token === token);
    return { symbol: k?.symbol ?? token.slice(0, 4), decimals: m.decimals, tokenProgram: m.tokenProgram };
  }
  if (sameToken(token, NATIVE_EVM)) return { symbol: getChain(t.chain)!.nativeSymbol, decimals: 18 };
  const k = KNOWN_TOKENS[t.chain]?.find((x) => sameToken(x.token, token)) ?? t.feeConfig?.tokens.find((x) => sameToken(x.token, token));
  if (!k) throw new TreasuryError(400, "Token is not a known or configured token for this treasury.");
  return { symbol: k.symbol, decimals: k.decimals };
}

const ixJson = (ix: TransactionInstruction) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(ix.data).toString("base64") });

async function solanaTx(signer: string, ixs: TransactionInstruction[]) {
  const { value } = await srpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = Buffer.from(new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(signer), recentBlockhash: value.blockhash, instructions: ixs }).compileToV0Message()).serialize()).toString("base64");
  const sim = await srpc<{ value: { err: unknown; unitsConsumed?: number; logs: string[] | null } }>("simulateTransaction", [tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }]);
  return { tx, sim: sim.value };
}

async function evmSimulate(chain: string, from: string, txs: { to: string; data: string; value: string }[]): Promise<{ ok: boolean; detail: string }> {
  try {
    // Only the first call can be simulated in isolation (later calls may depend on an approval).
    const first = txs[0];
    await erpc(chain, "eth_call", [{ from, to: first.to, data: first.data, value: first.value }, "latest"]);
    const gas = await erpc<string>(chain, "eth_estimateGas", [{ from, to: first.to, data: first.data, value: first.value }]);
    return { ok: true, detail: `First call simulates successfully (≈${hexToBig(gas).toString()} gas).${txs.length > 1 ? " Later calls depend on it and are simulated by the wallet/Safe at signing." : ""}` };
  } catch (e) {
    return { ok: false, detail: `Simulation reverted: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function safeBatch(t: Treasury, name: string, txs: { to: string; data: string; value: string }[]) {
  return {
    version: "1.0", chainId: String(getChain(t.chain)!.evmChainId), createdAt: Date.now(),
    meta: { name, description: "Prepared by Bajar Treasury. Review every call before signing.", txBuilderVersion: "1.16.5", createdFromSafeAddress: t.address, createdFromOwnerAddress: "", checksum: "" },
    transactions: txs.map((x) => ({ to: x.to, value: x.value, data: x.data, contractMethod: null, contractInputsValues: null })),
  };
}

export async function buildTransfer(t: Treasury, toId: string, token: string, amount: string): Promise<OpResult> {
  const dest = await getTreasury(toId);
  if (!dest || dest.id === t.id) throw new TreasuryError(400, "Destination must be another registered treasury.");
  if (dest.chain !== t.chain) throw new TreasuryError(400, "Destination treasury is on a different network.");
  if (!dest.integrityOk || !dest.ownership) throw new TreasuryError(400, "Destination treasury must pass integrity and ownership verification (address allowlist).");
  if (t.kind === "jupiter_referral") throw new TreasuryError(400, "Referral fees are claimed by the partner wallet on referral.jup.ag, then managed from that wallet.");
  const meta = await tokenMeta(t, token);
  const raw = toRaw(amount, meta.decimals);
  const summary = `Transfer ${amount} ${meta.symbol} from ${t.label} to ${dest.label} (${dest.address})`;

  if (t.chainType === "solana") {
    const from = t.address;
    let ixs: TransactionInstruction[];
    if (token === WSOL) ixs = [SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(dest.address), lamports: raw })];
    else {
      const prog = meta.tokenProgram ?? TOKEN_PROGRAM;
      const src = ata(from, token, prog), dst = ata(dest.address, token, prog);
      const data = Buffer.alloc(10);
      data.writeUInt8(12, 0); // TransferChecked
      data.writeBigUInt64LE(raw, 1);
      data.writeUInt8(meta.decimals, 9);
      ixs = [createAtaIdempotentIx(from, dest.address, token, prog), new TransactionInstruction({
        programId: new PublicKey(prog),
        keys: [{ pubkey: new PublicKey(src), isSigner: false, isWritable: true }, { pubkey: new PublicKey(token), isSigner: false, isWritable: false }, { pubkey: new PublicKey(dst), isSigner: false, isWritable: true }, { pubkey: new PublicKey(from), isSigner: true, isWritable: false }],
        data,
      })];
    }
    if (t.kind === "squads") return { kind: "squads-instructions", multisig: String(t.inspection?.multisig), vault: from, instructions: ixs.map(ixJson), simulation: { ok: true, detail: "Squads simulates the proposal before members approve it." }, summary };
    const { tx, sim } = await solanaTx(from, ixs);
    return { kind: "solana-tx", signer: from, transaction: tx, simulation: sim, summary };
  }

  const call = sameToken(token, NATIVE_EVM) ? { to: dest.address, data: "0x", value: raw.toString() } : { to: token, data: encodeErc20Transfer(dest.address, raw), value: "0" };
  const sim = await evmSimulate(t.chain, t.address, [call]);
  if (t.kind === "safe") return { kind: "safe-batch", safe: t.address, chainId: getChain(t.chain)!.evmChainId!, batch: safeBatch(t, summary, [call]), simulation: sim, summary };
  return { kind: "evm-txs", signer: t.address, chainId: getChain(t.chain)!.evmChainId!, transactions: [{ ...call, label: summary }], simulation: sim, summary };
}

export async function buildConvertToUsdc(t: Treasury, token: string, amount: string): Promise<OpResult> {
  if (t.kind === "jupiter_referral") throw new TreasuryError(400, "Claim referral fees to the partner wallet first.");
  const usdc = KNOWN_TOKENS[t.chain]?.find((x) => x.symbol === "USDC");
  if (!usdc) throw new TreasuryError(400, "No USDC configured for this network.");
  if (sameToken(token, usdc.token)) throw new TreasuryError(400, "Token is already USDC.");
  const meta = await tokenMeta(t, token);
  const raw = toRaw(amount, meta.decimals);
  const summary = `Convert ${amount} ${meta.symbol} to USDC in ${t.label} (no platform fee on treasury operations)`;
  if (t.chainType === "solana") {
    const b = await v2Build({ inputMint: token, outputMint: usdc.token, amount: raw.toString(), slippageBps: 50, taker: t.address });
    if (t.kind === "squads") {
      const ixs = [...b.setupInstructions, b.swapInstruction, ...(b.cleanupInstruction ? [b.cleanupInstruction] : [])];
      return { kind: "squads-instructions", multisig: String(t.inspection?.multisig), vault: t.address, instructions: [...ixs, { addressLookupTables: b.addressesByLookupTableAddress }], simulation: { ok: true, detail: `Quoted ${b.outAmount} USDC base units; Squads simulates before approval.` }, summary };
    }
    const tx = await assembleBuild(b, t.address);
    return { kind: "solana-tx", signer: t.address, transaction: tx.transaction, simulation: { err: null, unitsConsumed: tx.unitsConsumed }, summary: `${summary} — est. ${(Number(b.outAmount) / 1e6).toFixed(2)} USDC` };
  }
  const chainId = ZEROX_CHAINS[t.chain];
  const qte = await zeroXQuote({ chainId, sellToken: token, buyToken: usdc.token, sellAmount: raw.toString(), taker: t.address, slippageBps: 50 }, true);
  if (!qte.liquidityAvailable || !qte.transaction) throw new TreasuryError(400, "No liquidity for this conversion.");
  const txs: { to: string; data: string; value: string; label: string }[] = [];
  if (qte.issues.allowance && !sameToken(token, NATIVE_EVM)) txs.push({ to: token, data: encodeErc20Approve(qte.issues.allowance.spender, raw), value: "0", label: `Approve ${meta.symbol} for 0x AllowanceHolder` });
  txs.push({ to: qte.transaction.to, data: qte.transaction.data, value: qte.transaction.value, label: `Swap ${amount} ${meta.symbol} → ≥ ${(Number(qte.minBuyAmount) / 10 ** usdc.decimals).toFixed(2)} USDC` });
  const sim = await evmSimulate(t.chain, t.address, txs);
  if (t.kind === "safe") return { kind: "safe-batch", safe: t.address, chainId, batch: safeBatch(t, summary, txs), simulation: sim, summary };
  return { kind: "evm-txs", signer: t.address, chainId, transactions: txs, simulation: sim, summary };
}

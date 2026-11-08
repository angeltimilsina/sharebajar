/**
 * Bitcoin (native SegWit P2WPKH) transaction building and message signing.
 * Pure functions: callers supply UTXOs and fee rates fetched from the network.
 */
import * as btc from "@scure/btc-signer";
import { hex as hexCodec } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";

export interface Utxo { txid: string; vout: number; value: number; status?: { confirmed: boolean } }

export const DUST_P2WPKH = 294;
const NET = btc.NETWORK;

export function isBtcAddress(a: string): boolean {
  try { btc.Address(NET).decode(a); return true; } catch { return false; }
}

/** Approximate vsize for P2WPKH inputs + mixed outputs (used for fee estimation). */
export function estimateVsize(inputs: number, outputs: { type: string }[]): number {
  const outSize = (t: string) => (t === "wpkh" ? 31 : t === "tr" ? 43 : t === "sh" ? 32 : t === "pkh" ? 34 : t === "wsh" ? 43 : 43);
  return Math.ceil(10.5 + inputs * 68 + outputs.reduce((s, o) => s + outSize(o.type), 0));
}

const outType = (addr: string) => btc.Address(NET).decode(addr).type;

export interface SendPlan { inputs: Utxo[]; amount: number; fee: number; change: number; vsize: number; feeRate: number }

/** Largest-first coin selection. `amount = "max"` sweeps everything minus fee. */
export function planSend(utxos: Utxo[], to: string, amount: number | "max", feeRate: number, changeAddress: string): SendPlan {
  if (!isBtcAddress(to)) throw new Error("Invalid Bitcoin address.");
  if (!(feeRate >= 1)) throw new Error("Fee rate must be at least 1 sat/vB.");
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  if (amount === "max") {
    const total = sorted.reduce((s, u) => s + u.value, 0);
    const vsize = estimateVsize(sorted.length, [{ type: outType(to) }]);
    const fee = Math.ceil(vsize * feeRate);
    if (total - fee < DUST_P2WPKH) throw new Error("Balance too small to cover the network fee.");
    return { inputs: sorted, amount: total - fee, fee, change: 0, vsize, feeRate };
  }
  if (!Number.isInteger(amount) || amount < DUST_P2WPKH) throw new Error(`Amount must be at least ${DUST_P2WPKH} sats.`);
  const picked: Utxo[] = [];
  let total = 0;
  for (const u of sorted) {
    picked.push(u);
    total += u.value;
    const withChange = estimateVsize(picked.length, [{ type: outType(to) }, { type: outType(changeAddress) }]);
    const feeWith = Math.ceil(withChange * feeRate);
    if (total >= amount + feeWith + DUST_P2WPKH) return { inputs: picked, amount, fee: feeWith, change: total - amount - feeWith, vsize: withChange, feeRate };
    const noChange = estimateVsize(picked.length, [{ type: outType(to) }]);
    const feeNo = Math.ceil(noChange * feeRate);
    if (total >= amount + feeNo) return { inputs: picked, amount, fee: total - amount, change: 0, vsize: noChange, feeRate }; // remainder (< dust) goes to miners
  }
  throw new Error("Insufficient balance for amount + network fee.");
}

/** Build and sign a P2WPKH transaction from a plan. Returns raw hex + txid. */
export function signSend(plan: SendPlan, to: string, changeAddress: string, privateKey: Uint8Array): { hex: string; txid: string; vsize: number } {
  const pub = secp256k1.getPublicKey(privateKey, true);
  const pay = btc.p2wpkh(pub, NET);
  const tx = new btc.Transaction();
  for (const u of plan.inputs) tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: pay.script, amount: BigInt(u.value) } });
  tx.addOutputAddress(to, BigInt(plan.amount), NET);
  if (plan.change > 0) tx.addOutputAddress(changeAddress, BigInt(plan.change), NET);
  tx.sign(privateKey);
  tx.finalize();
  return { hex: tx.hex, txid: tx.id, vsize: tx.vsize };
}

/** Sign the inputs we own in a provider-built PSBT (e.g. LI.FI) without altering it. */
export function signPsbt(psbtHex: string, privateKey: Uint8Array): { hex: string; txid: string; outputs: { address: string | null; amount: bigint }[] } {
  const tx = btc.Transaction.fromPSBT(hexCodec.decode(psbtHex));
  const signed = tx.sign(privateKey);
  if (!signed) throw new Error("This PSBT has no inputs belonging to your Bajar Bitcoin address.");
  tx.finalize();
  const outputs = Array.from({ length: tx.outputsLength }, (_, i) => {
    const o = tx.getOutput(i);
    let address: string | null = null;
    try { address = btc.Address(NET).encode(btc.OutScript.decode(o.script!)); } catch { /* OP_RETURN etc */ }
    return { address, amount: o.amount ?? BigInt(0) };
  });
  return { hex: tx.hex, txid: tx.id, outputs };
}

/** Inspect a PSBT before signing (amounts, destinations) so the user can review it. */
export function describePsbt(psbtHex: string) {
  const tx = btc.Transaction.fromPSBT(hexCodec.decode(psbtHex));
  const inputs = Array.from({ length: tx.inputsLength }, (_, i) => Number(tx.getInput(i).witnessUtxo?.amount ?? BigInt(0)));
  const inputAddresses = Array.from({ length: tx.inputsLength }, (_, i) => {
    const sc = tx.getInput(i).witnessUtxo?.script;
    try { return sc ? btc.Address(NET).encode(btc.OutScript.decode(sc)) : null; } catch { return null; }
  });
  const missingAmounts = Array.from({ length: tx.inputsLength }, (_, i) => !tx.getInput(i).witnessUtxo).some(Boolean);
  const outputs = Array.from({ length: tx.outputsLength }, (_, i) => {
    const o = tx.getOutput(i);
    let address: string | null = null;
    try { address = btc.Address(NET).encode(btc.OutScript.decode(o.script!)); } catch { address = null; }
    return { address, amount: Number(o.amount ?? BigInt(0)) };
  });
  const totalIn = inputs.reduce((s, v) => s + v, 0);
  const totalOut = outputs.reduce((s, o) => s + o.amount, 0);
  return { inputs: inputs.length, totalIn, inputAddresses, outputs, fee: missingAmounts ? null : totalIn - totalOut };
}

/* ------------------- BIP-137 message signatures ------------------- */

function varint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  throw new Error("message too long");
}

export function bitcoinMessageHash(message: string): Uint8Array {
  const prefix = new TextEncoder().encode("\x18Bitcoin Signed Message:\n");
  const msg = new TextEncoder().encode(message);
  const data = new Uint8Array([...prefix, ...varint(msg.length), ...msg]);
  return sha256(sha256(data));
}

/** Sign as P2WPKH (header 39–42), compatible with Electrum/Trezor/Sparrow verification. */
export function signBitcoinMessage(privateKey: Uint8Array, message: string): string {
  const sig = secp256k1.sign(bitcoinMessageHash(message), privateKey);
  const out = new Uint8Array(65);
  out[0] = 39 + sig.recovery!;
  out.set(sig.toCompactRawBytes(), 1);
  return btoa(String.fromCharCode(...out));
}

/** Verify a BIP-137 signature for P2PKH, P2SH-P2WPKH or P2WPKH addresses. */
export function verifyBitcoinMessage(address: string, message: string, signatureB64: string): boolean {
  try {
    const raw = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    if (raw.length !== 65) return false;
    const header = raw[0];
    if (header < 27 || header > 42) return false;
    const recovery = (header - 27) % 4;
    const pub = secp256k1.Signature.fromCompact(raw.slice(1)).addRecoveryBit(recovery).recoverPublicKey(bitcoinMessageHash(message));
    const compressed = pub.toRawBytes(true);
    const candidates = header < 31
      ? [btc.p2pkh(pub.toRawBytes(false), NET).address]
      : [btc.p2wpkh(compressed, NET).address, btc.p2pkh(compressed, NET).address, btc.p2sh(btc.p2wpkh(compressed, NET), NET).address];
    return candidates.includes(address);
  } catch {
    return false;
  }
}

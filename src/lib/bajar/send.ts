"use client";
import { encodeFunctionData, erc20Abi, isAddress } from "viem";
import { bajar } from "./session";
import { requestApproval, UserRejected } from "./approvals";
import { walletRpc } from "./rpc";
import { planSend, signSend, isBtcAddress, signPsbt, describePsbt, type Utxo } from "./btc";
import { evmSendTransaction } from "./providers";
import { getChain } from "../chains";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const b64 = (u: Uint8Array) => { let s = ""; u.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const b = await r.json();
  if (!r.ok || b.error) throw new Error(b.error ?? `HTTP ${r.status}`);
  return b as T;
}

/* ----------------------------- Bitcoin ---------------------------- */

export interface BtcFees { fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number; minimumFee: number }
export const btcFees = () => api<BtcFees>("/api/wallet/btc?op=fees");

export async function previewBtcSend(to: string, amountSats: number | "max", feeRate: number) {
  const from = bajar.accounts()!.bitcoin.address;
  const utxos = await api<Utxo[]>(`/api/wallet/btc?op=utxos&address=${from}`);
  return planSend(utxos, to, amountSats, feeRate, from);
}

export async function sendBtc(to: string, amountSats: number | "max", feeRate: number): Promise<string> {
  if (!isBtcAddress(to)) throw new Error("Invalid Bitcoin address.");
  const from = bajar.accounts()!.bitcoin.address;
  const plan = await previewBtcSend(to, amountSats, feeRate);
  const ok = await requestApproval({
    kind: "transaction", network: "Bitcoin", title: "Send BTC (native)",
    rows: [["From", short(from)], ["To", to], ["Amount", `${(plan.amount / 1e8).toFixed(8)} BTC`], ["Network fee", `${(plan.fee / 1e8).toFixed(8)} BTC (${plan.feeRate} sat/vB · ${plan.vsize} vB)`], ["Change", `${(plan.change / 1e8).toFixed(8)} BTC → your address`], ["Inputs", String(plan.inputs.length)]],
  }, { to, plan });
  if (!ok) throw new UserRejected();
  const signed = signSend(plan, to, from, bajar.secrets().bitcoin);
  const { txid } = await api<{ txid: string }>("/api/wallet/btc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hex: signed.hex }) });
  recordLocal("bitcoin", txid, `Sent ${(plan.amount / 1e8).toFixed(8)} BTC to ${short(to)}`);
  return txid;
}

/** Sign a provider PSBT (e.g. LI.FI BTC → other chain). Data must stay unaltered. */
export async function signAndBroadcastPsbt(psbtHex: string, summary: string, extraRows: [string, string][] = []): Promise<string> {
  const d = describePsbt(psbtHex);
  const me = bajar.accounts()!.bitcoin.address;
  const rows: [string, string][] = [
    ...extraRows,
    ["Inputs", `${d.inputs} (${(d.totalIn / 1e8).toFixed(8)} BTC)`],
    ...d.outputs.map((o, i): [string, string] => [`Output ${i + 1}`, `${o.address ? (o.address === me ? "your change" : short(o.address)) : "OP_RETURN / script"} · ${(Number(o.amount) / 1e8).toFixed(8)} BTC`]),
    ["Network fee", d.fee === null ? "unknown" : `${(Number(d.fee) / 1e8).toFixed(8)} BTC`],
  ];
  const ok = await requestApproval({ kind: "transaction", network: "Bitcoin", title: summary, rows, warning: d.inputAddresses.some((a) => a !== me) ? "This PSBT spends inputs that are not yours." : undefined }, { psbtHex });
  if (!ok) throw new UserRejected();
  const signed = signPsbt(psbtHex, bajar.secrets().bitcoin);
  const { txid } = await api<{ txid: string }>("/api/wallet/btc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hex: signed.hex }) });
  recordLocal("bitcoin", txid, summary);
  return txid;
}

/* ------------------------------- EVM ------------------------------ */

export async function sendEvm(chainId: string, token: "native" | string, to: string, amountRaw: bigint, label: string): Promise<string> {
  if (!isAddress(to)) throw new Error("Invalid EVM address.");
  if (token === "native") return evmSendTransaction(chainId, { to, value: `0x${amountRaw.toString(16)}` }, `Send ${label} to ${short(to)}`);
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to as `0x${string}`, amountRaw] });
  return evmSendTransaction(chainId, { to: token, data }, `Send ${label} to ${short(to)}`);
}

/* ------------------------------ Solana ---------------------------- */

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export async function sendSolana(token: "native" | string, to: string, amountRaw: bigint, decimals: number, label: string): Promise<string> {
  const w3 = await import("@solana/web3.js");
  const { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, TransactionInstruction, ComputeBudgetProgram } = w3;
  let dest: InstanceType<typeof PublicKey>;
  try { dest = new PublicKey(to); } catch { throw new Error("Invalid Solana address."); }
  const owner = new PublicKey(bajar.accounts()!.solana.address);
  const ixs: InstanceType<typeof TransactionInstruction>[] = [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 })];
  if (token === "native") {
    ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: dest, lamports: amountRaw }));
  } else {
    const mint = new PublicKey(token);
    const info = await walletRpc<{ value: { owner: string } | null }>("solana", "getAccountInfo", [token, { encoding: "base64" }]);
    if (!info.value) throw new Error("Token mint not found.");
    const prog = new PublicKey(info.value.owner === TOKEN22 ? TOKEN22 : TOKEN);
    const ataProg = new PublicKey(ATA);
    const ata = (o: InstanceType<typeof PublicKey>) => PublicKey.findProgramAddressSync([o.toBuffer(), prog.toBuffer(), mint.toBuffer()], ataProg)[0];
    const src = ata(owner), dst = ata(dest);
    // create recipient ATA if missing (idempotent)
    ixs.push(new TransactionInstruction({ programId: ataProg, data: Buffer.from([1]), keys: [
      { pubkey: owner, isSigner: true, isWritable: true }, { pubkey: dst, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: prog, isSigner: false, isWritable: false },
    ] }));
    const data = Buffer.alloc(10); data[0] = 12; data.writeBigUInt64LE(amountRaw, 1); data[9] = decimals; // TransferChecked
    ixs.push(new TransactionInstruction({ programId: prog, data, keys: [
      { pubkey: src, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false },
    ] }));
  }
  const { value } = await walletRpc<{ value: { blockhash: string } }>("solana", "getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: value.blockhash, instructions: ixs }).compileToV0Message());
  const p = window.bajar!.solana;
  const res = await p.signAndSendTransaction!(tx) as { signature: string };
  recordLocal("solana", res.signature, `Sent ${label} to ${short(to)}`);
  return res.signature;
}

/** Solana tx from a provider (Jupiter/LI.FI), base64. Approve → sign → send. */
export async function signAndSendSolanaB64(base64Tx: string): Promise<string> {
  const { VersionedTransaction } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0)));
  const res = await window.bajar!.solana.signAndSendTransaction!(tx) as { signature: string };
  return res.signature;
}
export async function signSolanaB64(base64Tx: string): Promise<string> {
  const { VersionedTransaction } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0)));
  const signed = await window.bajar!.solana.signTransaction!(tx);
  return b64(signed.serialize());
}

/* ----------------------------- Activity --------------------------- */

export interface LocalActivity { network: string; hash: string; summary: string; at: number }
export function recordLocal(network: string, hash: string, summary: string) {
  try {
    const list = JSON.parse(localStorage.getItem("bajar.activity.v1") ?? "[]");
    localStorage.setItem("bajar.activity.v1", JSON.stringify([{ network, hash, summary, at: Date.now() }, ...list].slice(0, 200)));
  } catch { /* ignore */ }
}
export function localActivity(): LocalActivity[] {
  try { return JSON.parse(localStorage.getItem("bajar.activity.v1") ?? "[]"); } catch { return []; }
}
export function explorerTx(network: string, hash: string) {
  if (network === "bitcoin") return `https://mempool.space/tx/${hash}`;
  const c = getChain(network);
  return c ? c.explorer.tx + hash : "#";
}

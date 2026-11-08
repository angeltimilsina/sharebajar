"use client";
import { privateKeyToAccount } from "viem/accounts";
import type { InjectedSolana } from "../wallet/solana";
import type { Eip1193 } from "../wallet/evm";
import { CHAINS, chainFromEvmId, getChain } from "../chains";
import { bajar, saveSettings, settings } from "./session";
import { requestApproval, UserRejected } from "./approvals";
import { walletRpc } from "./rpc";
import { solanaSign } from "./keys";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const b64 = (u: Uint8Array) => { let s = ""; u.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };

/* ----------------------------- Solana ----------------------------- */

async function describeSolanaTx(tx: unknown): Promise<{ rows: [string, string][]; raw: string; warning?: string }> {
  const { VersionedTransaction } = await import("@solana/web3.js");
  const t = tx as { serialize: (o?: unknown) => Uint8Array; message?: unknown };
  const bytes = tx instanceof VersionedTransaction ? t.serialize() : t.serialize({ requireAllSignatures: false, verifySignatures: false });
  const raw = b64(bytes);
  const rows: [string, string][] = [];
  try {
    const vt = tx instanceof VersionedTransaction ? tx : VersionedTransaction.deserialize(bytes);
    const keys = vt.message.staticAccountKeys;
    const progs = [...new Set(vt.message.compiledInstructions.map((i) => keys[i.programIdIndex]?.toBase58()).filter(Boolean))];
    rows.push(["Fee payer", short(keys[0].toBase58())], ["Programs", progs.map((p) => short(p!)).join(", ")]);
  } catch { /* legacy */ }
  let warning: string | undefined;
  try {
    const sim = await walletRpc<{ value: { err: unknown; unitsConsumed?: number } }>("solana", "simulateTransaction", [raw, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }]);
    rows.push(["Simulation", sim.value.err ? `FAILS: ${JSON.stringify(sim.value.err)}` : `OK (${sim.value.unitsConsumed?.toLocaleString() ?? "?"} CU)`]);
    if (sim.value.err) warning = "This transaction fails in simulation and would likely fail on-chain.";
  } catch (e) {
    rows.push(["Simulation", `unavailable (${(e as Error).message.slice(0, 60)})`]);
  }
  return { rows, raw, warning };
}

export function bajarSolanaProvider(): InjectedSolana & { isBajar: true } {
  const p: InjectedSolana & { isBajar: true } = {
    isBajar: true,
    get publicKey() { const a = bajar.accounts(); return a && bajar.isUnlocked() ? { toString: () => a.solana.address, toBase58: () => a.solana.address } : null; },
    get isConnected() { return bajar.isUnlocked(); },
    async connect() {
      if (!bajar.isUnlocked()) throw new Error("Unlock BAJAR Wallet first (open /wallet).");
      const a = bajar.accounts()!;
      return { publicKey: { toString: () => a.solana.address } };
    },
    async disconnect() { /* session-level only */ },
    async signMessage(message: Uint8Array) {
      const text = new TextDecoder().decode(message);
      const ok = await requestApproval({ kind: "message", network: "Solana", title: "Sign message", rows: [["Account", short(bajar.accounts()!.solana.address)]], raw: text }, { text });
      if (!ok) throw new UserRejected();
      const { ed25519 } = await import("@noble/curves/ed25519");
      return { signature: ed25519.sign(message, bajar.secrets().solana) };
    },
    async signTransaction(tx: unknown) {
      const d = await describeSolanaTx(tx);
      const ok = await requestApproval({ kind: "transaction", network: "Solana", title: "Approve Solana transaction", rows: d.rows, warning: d.warning }, { tx: d.raw });
      if (!ok) throw new UserRejected();
      const { Keypair, VersionedTransaction } = await import("@solana/web3.js");
      const kp = Keypair.fromSeed(bajar.secrets().solana);
      if (tx instanceof VersionedTransaction) tx.sign([kp]);
      else (tx as { partialSign: (k: unknown) => void }).partialSign(kp);
      return tx as { serialize(): Uint8Array };
    },
    async signAndSendTransaction(tx: unknown) {
      const signed = await p.signTransaction!(tx);
      const sig = await walletRpc<string>("solana", "sendTransaction", [b64(signed.serialize()), { encoding: "base64", maxRetries: 3, preflightCommitment: "confirmed" }]);
      return { signature: sig };
    },
    on() {}, off() {},
  };
  return p;
}

/** Sign raw message bytes with the Solana key (used by BAJAR's own hybrid sign-in). */
export const bajarSolanaSignText = (text: string) => solanaSign(bajar.secrets().solana, text);

/* ------------------------------ EVM ------------------------------- */

const evmListeners = new Map<string, Set<(...a: unknown[]) => void>>();
const emitEvm = (ev: string, ...a: unknown[]) => evmListeners.get(ev)?.forEach((f) => f(...a));
const toHex = (n: bigint | number) => `0x${BigInt(n).toString(16)}`;
const big = (h: string | undefined | null) => (h ? BigInt(h) : BigInt(0));

export function currentEvmChain() {
  return getChain(settings().evmChain) ?? getChain("ethereum")!;
}

function recordEvmTx(hash: string, chain: string, to: string, value: string, summary: string) {
  try {
    const list = JSON.parse(localStorage.getItem("bajar.evmtx.v1") ?? "[]");
    localStorage.setItem("bajar.evmtx.v1", JSON.stringify([{ hash, chain, to, value, summary, at: Date.now() }, ...list].slice(0, 100)));
  } catch { /* ignore */ }
}
export function evmTxHistory(): { hash: string; chain: string; to: string; value: string; summary: string; at: number }[] {
  try { return JSON.parse(localStorage.getItem("bajar.evmtx.v1") ?? "[]"); } catch { return []; }
}

/** Fill gas/fees/nonce, simulate, ask for approval, sign locally and broadcast. */
export async function evmSendTransaction(chainId: string, tx: { to: string; data?: string; value?: string; gas?: string }, summary?: string): Promise<string> {
  const c = getChain(chainId)!;
  const from = bajar.accounts()!.evm.address;
  const value = big(tx.value);
  const data = (tx.data ?? "0x") as `0x${string}`;
  const callObj = { from, to: tx.to, data, value: toHex(value) };
  let simNote = "OK";
  let warning: string | undefined;
  try { await walletRpc(c.id, "eth_call", [callObj, "latest"]); } catch (e) { simNote = `REVERTS: ${(e as Error).message.slice(0, 120)}`; warning = "This transaction reverts in simulation and would fail on-chain."; }
  const gas = tx.gas ? big(tx.gas) : await walletRpc<string>(c.id, "eth_estimateGas", [callObj]).then((g) => (big(g) * BigInt(12)) / BigInt(10)).catch(() => BigInt(250_000));
  const [nonceHex, block, tipHex] = await Promise.all([
    walletRpc<string>(c.id, "eth_getTransactionCount", [from, "pending"]),
    walletRpc<{ baseFeePerGas?: string }>(c.id, "eth_getBlockByNumber", ["latest", false]),
    walletRpc<string>(c.id, "eth_maxPriorityFeePerGas", []).catch(() => toHex(BigInt(1_000_000_000))),
  ]);
  const legacy = !block.baseFeePerGas;
  const gasPrice = legacy ? big(await walletRpc<string>(c.id, "eth_gasPrice", [])) : BigInt(0);
  const tip = big(tipHex);
  const maxFee = legacy ? gasPrice : big(block.baseFeePerGas) * BigInt(2) + tip;
  const maxCost = gas * maxFee;
  const ok = await requestApproval({
    kind: "transaction", network: c.name, title: summary ?? "Approve transaction",
    rows: [["From", short(from)], ["To", short(tx.to)], ["Value", `${Number(value) / 1e18} ${c.nativeSymbol}`], ["Data", data === "0x" ? "—" : `${data.slice(0, 10)}… (${(data.length - 2) / 2} bytes)`], ["Gas limit", gas.toString()], ["Max network fee", `${(Number(maxCost) / 1e18).toFixed(6)} ${c.nativeSymbol}`], ["Simulation", simNote]],
    warning,
  }, { chain: c.id, ...callObj, gas: gas.toString() });
  if (!ok) throw new UserRejected();
  const account = privateKeyToAccount(bajar.secrets().evm);
  const base = { chainId: c.evmChainId!, nonce: Number(big(nonceHex)), to: tx.to as `0x${string}`, value, data, gas };
  const raw = legacy
    ? await account.signTransaction({ ...base, type: "legacy", gasPrice })
    : await account.signTransaction({ ...base, type: "eip1559", maxFeePerGas: maxFee, maxPriorityFeePerGas: tip });
  const hash = await walletRpc<string>(c.id, "eth_sendRawTransaction", [raw]);
  recordEvmTx(hash, c.id, tx.to, value.toString(), summary ?? "Transaction");
  return hash;
}

export function bajarEvmProvider(): Eip1193 & { isBajar: true } {
  return {
    isBajar: true,
    async request({ method, params = [] }) {
      const a = bajar.accounts();
      const c = currentEvmChain();
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          if (!bajar.isUnlocked()) { if (method === "eth_accounts") return []; throw new Error("Unlock BAJAR Wallet first (open /wallet)."); }
          return [a!.evm.address];
        case "eth_chainId": return toHex(c.evmChainId!);
        case "wallet_switchEthereumChain": {
          const id = Number(BigInt((params[0] as { chainId: string }).chainId));
          const target = chainFromEvmId(id);
          if (!target) throw Object.assign(new Error("Unsupported network in BAJAR Wallet"), { code: 4902 });
          saveSettings({ evmChain: target.id });
          emitEvm("chainChanged", toHex(id));
          return null;
        }
        case "personal_sign": {
          const [hexMsg] = params as [string, string];
          const bytes = Uint8Array.from((hexMsg.replace(/^0x/, "").match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
          const text = new TextDecoder().decode(bytes);
          const ok = await requestApproval({ kind: "message", network: c.name, title: "Sign message", rows: [["Account", short(a!.evm.address)]], raw: text }, { text });
          if (!ok) throw new UserRejected();
          return privateKeyToAccount(bajar.secrets().evm).signMessage({ message: { raw: hexMsg as `0x${string}` } });
        }
        case "eth_sendTransaction": {
          const t = params[0] as { to: string; data?: string; value?: string; gas?: string };
          return evmSendTransaction(c.id, t);
        }
        default:
          return walletRpc(c.id, method, params as unknown[]);
      }
    },
    on(ev, cb) { const s = evmListeners.get(ev) ?? new Set(); s.add(cb); evmListeners.set(ev, s); },
    removeListener(ev, cb) { evmListeners.get(ev)?.delete(cb); },
  };
}

export const SUPPORTED_EVM = CHAINS.filter((c) => c.type === "evm");

declare global {
  interface Window { bajar?: { solana: ReturnType<typeof bajarSolanaProvider>; evm: ReturnType<typeof bajarEvmProvider> } }
}

/** Make BAJAR selectable in the wallet picker; emits disconnect when the wallet locks. */
export function registerBajarProviders() {
  if (window.bajar) return;
  const solana = bajarSolanaProvider();
  const solListeners = new Map<string, Set<(a?: unknown) => void>>();
  solana.on = (ev: string, cb: (a?: unknown) => void) => { const s = solListeners.get(ev) ?? new Set(); s.add(cb); solListeners.set(ev, s); };
  solana.off = (ev: string, cb: (a?: unknown) => void) => { solListeners.get(ev)?.delete(cb); };
  window.bajar = { solana, evm: bajarEvmProvider() };
  let wasUnlocked = bajar.isUnlocked();
  bajar.subscribe(() => {
    const now = bajar.isUnlocked();
    if (wasUnlocked && !now) { solListeners.get("disconnect")?.forEach((f) => f()); emitEvm("accountsChanged", []); }
    wasUnlocked = now;
  });
}

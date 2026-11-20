"use client";
import { Buffer } from "buffer";
import bs58 from "bs58";
import type { Keypair } from "@solana/web3.js";
import { buildLaunchTransaction, MINT_SIZE } from "@/lib/launch/solanaToken";
import { buildManageTransaction, type SolanaTokenState } from "@/lib/launch/manage";

/**
 * Learn sandbox: a practice key that only ever touches Solana DEVNET, where
 * coins are free and worthless. It's stored in this browser so students can
 * come back to it. Never use it on mainnet or send real funds to it.
 */
const KEY = "bajar.learn.devnetKey";
const TOKENS = "bajar.learn.tokens";

export async function devnetRpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch("/api/wallet/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "solana-devnet", method, params }) });
  const b = await r.json().catch(() => null) as { result?: T; error?: { message?: string } } | null;
  if (!b || b.error) throw new Error(b?.error?.message ?? `Devnet request failed (HTTP ${r.status})`);
  return b.result as T;
}

export async function practiceKey(): Promise<Keypair> {
  const { Keypair } = await import("@solana/web3.js");
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return Keypair.fromSecretKey(bs58.decode(saved));
  } catch { /* new key below */ }
  const kp = Keypair.generate();
  try { localStorage.setItem(KEY, bs58.encode(kp.secretKey)); } catch { /* private mode: session only */ }
  return kp;
}

export async function resetPracticeKey() { try { localStorage.removeItem(KEY); localStorage.removeItem(TOKENS); } catch { /* ignore */ } }

export interface PracticeToken { mint: string; symbol: string; name: string; decimals: number; supplyRaw: string; createdAt: number }
export const practiceTokens = (): PracticeToken[] => { try { return JSON.parse(localStorage.getItem(TOKENS) ?? "[]"); } catch { return []; } };
const saveTokens = (l: PracticeToken[]) => { try { localStorage.setItem(TOKENS, JSON.stringify(l.slice(0, 20))); } catch { /* ignore */ } };

export const balanceSol = async (address: string) => (await devnetRpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }])).value / 1e9;

export async function airdrop(address: string): Promise<string> {
  const sig = await devnetRpc<string>("requestAirdrop", [address, 1_000_000_000]);
  await waitConfirmed(sig);
  return sig;
}

async function waitConfirmed(sig: string) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = await devnetRpc<{ value: ({ err: unknown; confirmationStatus: string } | null)[] }>("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]).catch(() => null);
    const v = st?.value[0];
    if (v?.err) throw new Error("Transaction failed on devnet.");
    if (v && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) return;
  }
  throw new Error("Devnet is slow right now — check the explorer link in a minute.");
}

async function sendSigned(tx: { serialize(): Buffer | Uint8Array }) {
  const sig = await devnetRpc<string>("sendTransaction", [Buffer.from(tx.serialize()).toString("base64"), { encoding: "base64", preflightCommitment: "confirmed" }]);
  await waitConfirmed(sig);
  return sig;
}

/** Launch a practice SPL token on devnet (same builder as the real launchpad). */
export async function launchPractice(kp: Keypair, p: { name: string; symbol: string; supply: bigint; decimals: number; revokeMint: boolean }) {
  const [{ value: { blockhash } }, rentMint] = await Promise.all([devnetRpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]), devnetRpc<number>("getMinimumBalanceForRentExemption", [MINT_SIZE])]);
  const { tx, mintAddress } = await buildLaunchTransaction({ payer: kp.publicKey.toBase58(), name: p.name, symbol: p.symbol, uri: "", decimals: p.decimals, supply: p.supply, revokeMint: p.revokeMint, revokeFreeze: true, immutable: false, launchFee: null }, { blockhash, rent: { mint: rentMint }, computeUnits: 200_000 });
  tx.partialSign(kp);
  const sig = await sendSigned(tx);
  const t: PracticeToken = { mint: mintAddress, symbol: p.symbol, name: p.name, decimals: p.decimals, supplyRaw: (p.supply * BigInt(10) ** BigInt(p.decimals)).toString(), createdAt: Date.now() };
  saveTokens([t, ...practiceTokens()]);
  return { sig, mint: mintAddress };
}

export async function tokenBalanceRaw(owner: string, mint: string): Promise<bigint> {
  const r = await devnetRpc<{ value: { account: { data: { parsed?: { info: { mint: string; tokenAmount: { amount: string } } } } } }[] }>("getTokenAccountsByOwner", [owner, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }]);
  return r.value.filter((a) => a.account.data.parsed?.info.mint === mint).reduce((s, a) => s + BigInt(a.account.data.parsed?.info.tokenAmount.amount ?? "0"), BigInt(0));
}

/** Burn or revoke on a practice token (same instruction builders as the token manager). */
export async function managePractice(kp: Keypair, t: PracticeToken, action: { kind: "burn"; amountRaw: bigint } | { kind: "revokeMint" }) {
  const owner = kp.publicKey.toBase58();
  const mint = await devnetRpc<{ value: { data: { parsed?: { info: { supply: string; mintAuthority: string | null; freezeAuthority: string | null } } } } | null }>("getAccountInfo", [t.mint, { encoding: "jsonParsed" }]);
  const info = mint.value?.data.parsed?.info;
  if (!info) throw new Error("Practice token not found on devnet.");
  const state: SolanaTokenState = { mint: t.mint, decimals: t.decimals, supplyRaw: BigInt(info.supply), mintAuthority: info.mintAuthority, freezeAuthority: info.freezeAuthority, metadata: null, balanceRaw: await tokenBalanceRaw(owner, t.mint), tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" };
  const { value: { blockhash } } = await devnetRpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = await buildManageTransaction(state, owner, action, blockhash);
  tx.sign(kp);
  return sendSigned(tx);
}

export const devnetExplorer = (kind: "tx" | "address", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

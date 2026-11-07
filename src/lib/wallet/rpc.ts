"use client";

/** Lightweight Solana JSON-RPC client (no SDK needed for reads). */
export const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

let id = 1;
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
  });
  if (res.status === 403 || res.status === 429) throw new Error(`Solana RPC refused the request (${res.status}). Configure NEXT_PUBLIC_SOLANA_RPC_URL with a dedicated RPC provider.`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result as T;
}

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function getSolBalance(address: string): Promise<number> {
  const r = await rpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]);
  return r.value / 1e9;
}

export interface SplHolding { mint: string; amount: number; decimals: number }

export async function getSplHoldings(owner: string): Promise<SplHolding[]> {
  const out: SplHolding[] = [];
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const r = await rpc<{ value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number; decimals: number } } } } } }[] }>(
      "getTokenAccountsByOwner",
      [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }],
    );
    for (const a of r.value) {
      const info = a.account.data.parsed.info;
      if (info.tokenAmount.uiAmount > 0) out.push({ mint: info.mint, amount: info.tokenAmount.uiAmount, decimals: info.tokenAmount.decimals });
    }
  }
  return out;
}

export interface SigInfo { signature: string; slot: number; blockTime: number | null; err: unknown; memo: string | null }
export const getRecentSignatures = (address: string, limit = 20) => rpc<SigInfo[]>("getSignaturesForAddress", [address, { limit }]);

export interface SimResult { err: unknown; logs: string[] | null; unitsConsumed?: number }
/** Simulate an unsigned tx before asking the user to sign it. */
export async function simulateBase64(tx: string): Promise<SimResult> {
  const r = await rpc<{ value: SimResult }>("simulateTransaction", [tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "processed" }]);
  return r.value;
}

export interface SigStatus { confirmationStatus: "processed" | "confirmed" | "finalized" | null; err: unknown }
export async function getSignatureStatus(sig: string): Promise<SigStatus | null> {
  const r = await rpc<{ value: (SigStatus | null)[] }>("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]);
  return r.value[0];
}

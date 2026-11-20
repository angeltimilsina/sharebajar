"use client";

/**
 * Lightweight Solana JSON-RPC client (no SDK needed for reads). Requests go
 * through Bajar's same-origin relay (/api/wallet/rpc): method-allowlisted,
 * size-bounded and rate-limited, and allowed by the site's connect-src policy.
 * The browser never talks to an RPC node directly.
 */
export const SOLANA_RPC = "/api/wallet/rpc";

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch("/api/wallet/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chain: "solana", method, params }),
  });
  if (res.status === 429) throw new Error("Too many network requests. Wait a moment and try again.");
  const body = await res.json().catch(() => ({ error: { message: `Network relay error (${res.status})` } }));
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

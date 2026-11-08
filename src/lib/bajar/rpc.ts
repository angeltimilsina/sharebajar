"use client";

/** BAJAR Wallet network access through ShareBajar's allowlisted RPC relay. */
export async function walletRpc<T>(chain: string, method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch("/api/wallet/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, method, params }) });
  const b = await r.json();
  if (b.error) throw new Error(b.error.message ?? "RPC error");
  return b.result as T;
}

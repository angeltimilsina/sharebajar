"use client";
import bs58 from "bs58";

/* Minimal typing of the injected Solana wallet API (Phantom-compatible). */
export interface InjectedSolana {
  publicKey: { toString(): string; toBase58?: () => string } | null;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } } | void>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array } | Uint8Array>;
  signAndSendTransaction?(tx: unknown, opts?: unknown): Promise<{ signature: string } | string>;
  signTransaction?(tx: unknown): Promise<{ serialize(): Uint8Array }>;
  on?(event: string, cb: (arg?: unknown) => void): void;
  off?(event: string, cb: (arg?: unknown) => void): void;
  removeListener?(event: string, cb: (arg?: unknown) => void): void;
}

declare global {
  interface Window {
    phantom?: { solana?: InjectedSolana & { isPhantom?: boolean } };
    solana?: InjectedSolana & { isPhantom?: boolean };
    solflare?: InjectedSolana & { isSolflare?: boolean };
    backpack?: InjectedSolana & { isBackpack?: boolean };
  }
}

export const SOLANA_WALLETS = [
  { id: "phantom", name: "Phantom", installUrl: "https://phantom.com/download", get: () => window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : undefined) },
  { id: "solflare", name: "Solflare", installUrl: "https://solflare.com/download", get: () => (window.solflare?.isSolflare ? window.solflare : undefined) },
  { id: "backpack", name: "Backpack", installUrl: "https://backpack.app/download", get: () => window.backpack },
] as const;

export function getSolanaProvider(id: string): InjectedSolana | undefined {
  if (typeof window === "undefined") return undefined;
  return SOLANA_WALLETS.find((w) => w.id === id)?.get();
}

export async function solanaSignMessage(p: InjectedSolana, message: string): Promise<string> {
  const res = await p.signMessage(new TextEncoder().encode(message), "utf8");
  const sig = res instanceof Uint8Array ? res : res.signature;
  return bs58.encode(sig);
}

/**
 * Deserialize a base64 versioned transaction (from Jupiter) and ask the wallet
 * to sign + send it. The user sees and approves it in their wallet.
 */
export async function solanaSignAndSend(p: InjectedSolana, base64Tx: string, rpcUrl: string): Promise<string> {
  const { VersionedTransaction, Connection } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0)));
  if (p.signAndSendTransaction) {
    const res = await p.signAndSendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
    return typeof res === "string" ? res : res.signature;
  }
  if (!p.signTransaction) throw new Error("Wallet cannot sign transactions");
  const signed = await p.signTransaction(tx);
  const conn = new Connection(rpcUrl, "confirmed");
  return conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
}

/** Sign without sending (Jupiter /order route: Jupiter lands it via /execute). */
export async function solanaSignOnly(p: InjectedSolana, base64Tx: string): Promise<string> {
  const { VersionedTransaction } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0)));
  if (!p.signTransaction) throw new Error("Wallet cannot sign transactions");
  const signed = await p.signTransaction(tx);
  const bytes = signed.serialize();
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

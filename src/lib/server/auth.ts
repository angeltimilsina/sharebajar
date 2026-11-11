import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import bs58 from "bs58";
import type { ChainType } from "../types";

/**
 * Wallet-based sign-in. The user signs a human-readable message (no
 * transaction, no fees). We verify the signature server-side and issue an
 * HMAC-signed, httpOnly session cookie. No seed phrases, no private keys.
 */
const g = globalThis as unknown as { __sbSecret?: string };
function secret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Dev fallback: per-process random secret (sessions reset on restart).
  return (g.__sbSecret ??= randomBytes(32).toString("hex"));
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

/**
 * Signed tokens are bound to a purpose (domain separation): a sign-in
 * challenge token can never be accepted as a session, and vice versa.
 */
export type TokenPurpose = "session" | "nonce" | "link" | "order" | "oauth";

export function seal(obj: object, purpose: TokenPurpose): string {
  const p = b64u(JSON.stringify(obj));
  return `${p}.${sign(`${purpose}.${p}`)}`;
}

export function unseal<T>(token: string | undefined, purpose: TokenPurpose): T | null {
  if (!token || token.length > 8192) return null;
  const [p, s, extra] = token.split(".");
  if (!p || !s || extra !== undefined) return null;
  const expected = Buffer.from(sign(`${purpose}.${p}`));
  const got = Buffer.from(s);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const obj = JSON.parse(Buffer.from(p, "base64url").toString()) as T & { exp?: number };
    if (obj.exp && obj.exp < Date.now()) return null;
    return obj;
  } catch {
    return null;
  }
}

export const NONCE_COOKIE = "sb_nonce";
export const SESSION_COOKIE = "sb_session";

export function newNonce() {
  return randomBytes(16).toString("hex");
}

export function signInMessage(chainType: ChainType, address: string, nonce: string, issuedAt: string, domain: string, pqFingerprint?: string) {
  const lines = [
    `${domain} wants you to sign in with your ${chainType === "solana" ? "Solana" : "Ethereum"} account:`,
    address,
    "",
    "Sign in to Bajar. This request will not trigger a blockchain transaction or cost any fees.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ];
  // Hybrid sign-in (Bajar Wallet): the same message is also signed with ML-DSA-65.
  if (pqFingerprint) lines.push(`Post-Quantum Key (ML-DSA-65): ${pqFingerprint}`);
  return lines.join("\n");
}

export function verifySolana(message: string, signatureB58: string, address: string): boolean {
  try {
    return ed25519.verify(bs58.decode(signatureB58), new TextEncoder().encode(message), bs58.decode(address));
  } catch {
    return false;
  }
}

export function recoverEvmAddress(message: string, signatureHex: string): string | null {
  try {
    const msg = new TextEncoder().encode(message);
    const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`);
    const full = new Uint8Array(prefix.length + msg.length);
    full.set(prefix);
    full.set(msg, prefix.length);
    const hash = keccak_256(full);
    const sig = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");
    if (sig.length !== 65) return null;
    let v = sig[64];
    if (v >= 27) v -= 27;
    const pub = secp256k1.Signature.fromCompact(sig.subarray(0, 64)).addRecoveryBit(v).recoverPublicKey(hash).toRawBytes(false);
    const addr = keccak_256(pub.subarray(1)).subarray(-20);
    return `0x${Buffer.from(addr).toString("hex")}`;
  } catch {
    return null;
  }
}

export function verifyEvm(message: string, signatureHex: string, address: string): boolean {
  const rec = recoverEvmAddress(message, signatureHex);
  return !!rec && rec.toLowerCase() === address.toLowerCase();
}

export interface Session { address: string; chainType: ChainType; exp: number; /** set when the sign-in was also verified with an ML-DSA-65 signature */ pq?: { alg: "ML-DSA-65"; fingerprint: string }; /** issued-at (ms) — admin actions require a recent sign-in */ iat?: number }

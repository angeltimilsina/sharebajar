/**
 * Bajar Wallet key derivation (runs only in the user's browser).
 *
 * One BIP-39 recovery phrase → per-network keys using each network's required
 * signature scheme, plus a supplementary post-quantum identity:
 *   Bitcoin  BIP-84  m/84'/0'/0'/0/i   secp256k1 · native SegWit (P2WPKH, bc1q…)
 *   EVM      BIP-44  m/44'/60'/0'/0/i  secp256k1 · same address on every EVM chain
 *   Solana   SLIP-10 m/44'/501'/i'/0'  Ed25519   · Phantom/Solflare-compatible path
 *   BAJAR PQ ML-DSA-65 (NIST FIPS 204), seed = HMAC-SHA512("BAJAR/ML-DSA-65/v1", bip39Seed)[0..32]
 *
 * ML-DSA-65 does NOT secure Bitcoin, Ethereum or Solana transactions — those
 * networks only accept secp256k1/Ed25519. It protects BAJAR account
 * authentication, backup authenticity and transaction-authorization records.
 */
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import * as btc from "@scure/btc-signer";
import { ed25519 } from "@noble/curves/ed25519";
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { privateKeyToAccount } from "viem/accounts";
import bs58 from "bs58";

export const PQ_ALG = "ML-DSA-65" as const;
export const PQ_DERIVATION = "bajar-mldsa65-hmac-sha512-v1" as const;
export const KEY_SCHEME_VERSION = 1;

export const PATHS = {
  bitcoin: (i = 0) => `m/84'/0'/0'/0/${i}`,
  evm: (i = 0) => `m/44'/60'/0'/0/${i}`,
  solana: (i = 0) => `m/44'/501'/${i}'/0'`,
};

/**
 * Solana derivation schemes used by other wallets, so imported phrases find
 * their existing funds. (Bitcoin BIP-84 and EVM m/44'/60'/0'/0/0 are the same
 * across MetaMask, Ledger, Trust, Electrum/Sparrow native SegWit, etc.)
 */
export const SOLANA_PATHS = {
  standard: { label: "Phantom, Solflare, Backpack, Ledger", path: (i = 0) => `m/44'/501'/${i}'/0'` },
  bip44: { label: "Trust Wallet, Exodus, Solflare (legacy)", path: (i = 0) => `m/44'/501'/${i}'` },
} as const;
export type SolanaPathId = keyof typeof SOLANA_PATHS;

export interface DeriveOptions { index?: number; passphrase?: string; solanaPath?: SolanaPathId }

/** Valid BIP-39 lengths. */
export const PHRASE_LENGTHS = [12, 15, 18, 21, 24] as const;

/**
 * Extract recovery-phrase words from anything a user might paste: strips
 * invisible characters (zero-width spaces/joiners, BOM), numbering ("1." /
 * "1)"), commas, line breaks, smart punctuation and capitals. English BIP-39
 * words are lowercase a–z only, so anything else is a separator.
 */
export function phraseWords(input: string): string[] {
  const ZW = "\u0001";
  const tokens = input
    .normalize("NFKD")
    .toLowerCase()
    // Invisible characters are ambiguous: sometimes they replace a space, sometimes they sit inside a word.
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, ZW)
    .split(/[^a-z\u0001]+/)
    .filter((t) => t.replace(/\u0001/g, ""));
  const out: string[] = [];
  for (const t of tokens) {
    if (!t.includes(ZW)) { out.push(t); continue; }
    const parts = t.split(ZW).filter(Boolean);
    const joined = parts.join("");
    // Keep a word whole if joining the pieces gives a real BIP-39 word; otherwise each piece is its own word.
    if (wordlist.includes(joined) || parts.length === 1) out.push(joined);
    else out.push(...parts);
  }
  return out;
}

export function newMnemonic(strength: 128 | 256 = 128): string {
  return generateMnemonic(wordlist, strength);
}

export function isValidMnemonic(m: string): boolean {
  const words = phraseWords(m);
  return (PHRASE_LENGTHS as readonly number[]).includes(words.length) && validateMnemonic(words.join(" "), wordlist);
}

export const normalizeMnemonic = (m: string) => phraseWords(m).join(" ");

/** SLIP-10 Ed25519 derivation (hardened only). */
export function slip10Ed25519(seed: Uint8Array, path: string): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  let key = I.slice(0, 32), chain = I.slice(32);
  for (const part of path.split("/").slice(1)) {
    if (!part.endsWith("'")) throw new Error("SLIP-10 Ed25519 supports hardened indexes only");
    const idx = (Number(part.slice(0, -1)) + 0x80000000) >>> 0;
    const data = new Uint8Array(37);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, idx);
    I = hmac(sha512, chain, data);
    key = I.slice(0, 32); chain = I.slice(32);
  }
  return key;
}

export interface PublicAccounts {
  bitcoin: { address: string; path: string; publicKey: string };
  evm: { address: `0x${string}`; path: string };
  solana: { address: string; path: string };
  pq: { alg: typeof PQ_ALG; derivation: typeof PQ_DERIVATION; publicKey: string; fingerprint: string };
}

export interface SecretKeys {
  bitcoin: Uint8Array;  // secp256k1 private key
  evm: `0x${string}`;    // secp256k1 private key (hex)
  solana: Uint8Array;   // Ed25519 seed (32 bytes)
  pq: Uint8Array;       // ML-DSA-65 secret key
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

/** Short, human-checkable fingerprint of the post-quantum public key. */
export function pqFingerprint(publicKey: Uint8Array): string {
  const h = hex(sha256(publicKey));
  return `${PQ_ALG}:${h.slice(0, 8)}-${h.slice(8, 16)}-${h.slice(16, 24)}`;
}

/** Solana address for a given scheme (for account discovery during import). */
export function solanaAddressFor(mnemonic: string, scheme: SolanaPathId, passphrase = "", index = 0): string {
  const seed = mnemonicToSeedSync(normalizeMnemonic(mnemonic), passphrase);
  return bs58.encode(ed25519.getPublicKey(slip10Ed25519(seed, SOLANA_PATHS[scheme].path(index))));
}

export function deriveAll(mnemonic: string, opts: number | DeriveOptions = {}): { pub: PublicAccounts; secret: SecretKeys } {
  const o: DeriveOptions = typeof opts === "number" ? { index: opts } : opts;
  const index = o.index ?? 0;
  const m = normalizeMnemonic(mnemonic);
  if (!isValidMnemonic(m)) throw new Error("Invalid recovery phrase (checksum failed).");
  // BIP-39 passphrase ("25th word"): NFKD-normalized by the library; empty = none.
  const seed = mnemonicToSeedSync(m, o.passphrase ?? "");
  const root = HDKey.fromMasterSeed(seed);

  const bnode = root.derive(PATHS.bitcoin(index));
  const bitcoinAddress = btc.p2wpkh(bnode.publicKey!, btc.NETWORK).address!;

  const enode = root.derive(PATHS.evm(index));
  const evmPriv = `0x${hex(enode.privateKey!)}` as `0x${string}`;
  const evmAddress = privateKeyToAccount(evmPriv).address;

  const solPath = SOLANA_PATHS[o.solanaPath ?? "standard"].path(index);
  const solSeed = slip10Ed25519(seed, solPath);
  const solAddress = bs58.encode(ed25519.getPublicKey(solSeed));

  const pqSeed = hmac(sha512, new TextEncoder().encode("BAJAR/ML-DSA-65/v1"), seed).slice(0, 32);
  const pq = ml_dsa65.keygen(pqSeed);

  return {
    pub: {
      bitcoin: { address: bitcoinAddress, path: PATHS.bitcoin(index), publicKey: hex(bnode.publicKey!) },
      evm: { address: evmAddress, path: PATHS.evm(index) },
      solana: { address: solAddress, path: solPath },
      pq: { alg: PQ_ALG, derivation: PQ_DERIVATION, publicKey: b64(pq.publicKey), fingerprint: pqFingerprint(pq.publicKey) },
    },
    secret: { bitcoin: bnode.privateKey!, evm: evmPriv, solana: solSeed, pq: pq.secretKey },
  };
}

/* ---------------- Post-quantum signatures (ML-DSA-65) ---------------- */

export const PQ_CONTEXTS = { auth: "BAJAR-AUTH-v1", backup: "BAJAR-BACKUP-v1", authorize: "BAJAR-TX-AUTH-v1" } as const;

export function pqSign(secretKey: Uint8Array, message: string | Uint8Array, context: keyof typeof PQ_CONTEXTS): string {
  const msg = typeof message === "string" ? new TextEncoder().encode(message) : message;
  return b64(ml_dsa65.sign(msg, secretKey, { context: new TextEncoder().encode(PQ_CONTEXTS[context]) }));
}

export function pqVerify(publicKeyB64: string, message: string | Uint8Array, signatureB64: string, context: keyof typeof PQ_CONTEXTS): boolean {
  try {
    const msg = typeof message === "string" ? new TextEncoder().encode(message) : message;
    return ml_dsa65.verify(fromB64(signatureB64), msg, fromB64(publicKeyB64), { context: new TextEncoder().encode(PQ_CONTEXTS[context]) });
  } catch {
    return false;
  }
}

export function solanaSign(seed: Uint8Array, message: string | Uint8Array): string {
  const msg = typeof message === "string" ? new TextEncoder().encode(message) : message;
  return bs58.encode(ed25519.sign(msg, seed));
}

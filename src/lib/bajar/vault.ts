/**
 * Encrypted local vault. The recovery phrase is encrypted in the browser with
 * a key derived from the user's password (scrypt) and AES-256-GCM, then stored
 * locally. It is never sent to any server. Every algorithm is recorded in the
 * file so future versions can migrate (e.g. to Argon2id or a PQ KEM wrap).
 */
import { scryptAsync } from "@noble/hashes/scrypt";
import { canonicalJson } from "./util";
import { PQ_DERIVATION, pqSign, pqVerify, type PublicAccounts, type SolanaPathId } from "./keys";

/** v1: plaintext = phrase. v2: plaintext = JSON { mnemonic, passphrase?, solanaPath? }. */
export const VAULT_VERSION = 2;

/** Everything needed to re-derive the wallet. Encrypted as one unit. */
export interface VaultSecret { mnemonic: string; passphrase?: string; solanaPath?: SolanaPathId }

export interface VaultFile {
  format: "bajar-vault";
  version: number;
  createdAt: string;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  cipher: { name: "AES-256-GCM"; iv: string };
  ciphertext: string;
  accounts: PublicAccounts;
  keyScheme: { version: number; pq: typeof PQ_DERIVATION };
  /** ML-DSA-65 signature over the rest of the file (backup authenticity). */
  pqSignature?: string;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const DEFAULT_KDF = { N: 2 ** 17, r: 8, p: 1 };
/** Accepted scrypt range: below MIN is too weak, above MAX could freeze the browser (malicious backup). */
const KDF_MIN_N = 2 ** 15, KDF_MAX_N = 2 ** 20;

/** Structural validation before any expensive work. Throws on anything unexpected. */
export function assertVaultShape(v: unknown): asserts v is VaultFile {
  const f = v as VaultFile;
  const isB64 = (s: unknown, bytes?: number) => typeof s === "string" && /^[A-Za-z0-9+/]+=*$/.test(s) && (bytes === undefined || unb64(s).length === bytes);
  if (!f || typeof f !== "object" || f.format !== "bajar-vault") throw new Error("Not a Bajar vault or backup file.");
  if (!Number.isInteger(f.version) || f.version < 1 || f.version > VAULT_VERSION) throw new Error("Unsupported vault version.");
  if (f.kdf?.name !== "scrypt" || !Number.isInteger(f.kdf.N) || (f.kdf.N & (f.kdf.N - 1)) !== 0 || f.kdf.N < KDF_MIN_N || f.kdf.N > KDF_MAX_N || f.kdf.r !== 8 || ![1, 2, 3, 4].includes(f.kdf.p)) throw new Error("Vault key-derivation settings are outside the safe range.");
  if (!isB64(f.kdf.salt, 16) || f.cipher?.name !== "AES-256-GCM" || !isB64(f.cipher.iv, 12) || !isB64(f.ciphertext) || f.ciphertext.length > 4000) throw new Error("Vault encryption fields are malformed.");
  if (!f.accounts?.bitcoin?.address || !f.accounts?.evm?.address || !f.accounts?.solana?.address || !f.accounts?.pq?.publicKey) throw new Error("Vault account metadata is missing.");
}

/** True when the stored vault uses weaker settings than today's default (re-encrypt on next unlock). */
export const needsKdfUpgrade = (v: VaultFile) => v.kdf.N < DEFAULT_KDF.N || v.version < VAULT_VERSION;

async function deriveKey(password: string, salt: Uint8Array, kdf: { N: number; r: number; p: number }, onProgress?: (p: number) => void) {
  const raw = await scryptAsync(new TextEncoder().encode(password.normalize("NFKC")), salt, { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32, onProgress });
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function createVault(secretIn: string | VaultSecret, password: string, accounts: PublicAccounts, pqSecret: Uint8Array, kdfParams = DEFAULT_KDF, onProgress?: (p: number) => void): Promise<VaultFile> {
  // Hard floor; the stronger policy for NEW passwords is enforced in session.ts.
  if (password.length < 10) throw new Error("Use a password of at least 10 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, kdfParams, onProgress);
  const vault: VaultFile = {
    format: "bajar-vault", version: VAULT_VERSION, createdAt: new Date().toISOString(),
    kdf: { name: "scrypt", ...kdfParams, salt: b64(salt) },
    cipher: { name: "AES-256-GCM", iv: b64(iv) },
    ciphertext: "",
    accounts,
    keyScheme: { version: 1, pq: PQ_DERIVATION },
  };
  // Bind the public metadata as additional authenticated data.
  const aad = new TextEncoder().encode(canonicalJson({ ...vault, ciphertext: undefined, pqSignature: undefined }));
  const sec: VaultSecret = typeof secretIn === "string" ? { mnemonic: secretIn } : secretIn;
  const plaintext = JSON.stringify({ mnemonic: sec.mnemonic, ...(sec.passphrase ? { passphrase: sec.passphrase } : {}), ...(sec.solanaPath && sec.solanaPath !== "standard" ? { solanaPath: sec.solanaPath } : {}) });
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, new TextEncoder().encode(plaintext));
  vault.ciphertext = b64(new Uint8Array(ct));
  vault.pqSignature = pqSign(pqSecret, canonicalJson({ ...vault, pqSignature: undefined }), "backup");
  return vault;
}

export async function openVault(v: VaultFile, password: string, onProgress?: (p: number) => void): Promise<VaultSecret> {
  assertVaultShape(v);
  const key = await deriveKey(password, unb64(v.kdf.salt), v.kdf, onProgress);
  const aad = new TextEncoder().encode(canonicalJson({ ...v, ciphertext: undefined, pqSignature: undefined }));
  let plain: string;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(v.cipher.iv), additionalData: aad }, key, unb64(v.ciphertext));
    plain = new TextDecoder().decode(pt);
  } catch {
    throw new Error("Wrong password or corrupted vault.");
  }
  if (v.version === 1 || !plain.startsWith("{")) return { mnemonic: plain };
  const o = JSON.parse(plain) as VaultSecret;
  if (typeof o.mnemonic !== "string") throw new Error("Vault contents are malformed.");
  return { mnemonic: o.mnemonic, passphrase: o.passphrase || undefined, solanaPath: o.solanaPath === "bip44" ? "bip44" : "standard" };
}

/** Verify a backup file's ML-DSA-65 signature against its embedded PQ public key. */
export function verifyVaultSignature(v: VaultFile): boolean {
  if (!v.pqSignature) return false;
  return pqVerify(v.accounts.pq.publicKey, canonicalJson({ ...v, pqSignature: undefined }), v.pqSignature, "backup");
}

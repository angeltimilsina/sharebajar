/**
 * Encrypted local vault. The recovery phrase is encrypted in the browser with
 * a key derived from the user's password (scrypt) and AES-256-GCM, then stored
 * locally. It is never sent to any server. Every algorithm is recorded in the
 * file so future versions can migrate (e.g. to Argon2id or a PQ KEM wrap).
 */
import { scryptAsync } from "@noble/hashes/scrypt";
import { canonicalJson } from "./util";
import { PQ_DERIVATION, pqSign, pqVerify, type PublicAccounts } from "./keys";

export const VAULT_VERSION = 1;

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

async function deriveKey(password: string, salt: Uint8Array, kdf: { N: number; r: number; p: number }, onProgress?: (p: number) => void) {
  const raw = await scryptAsync(new TextEncoder().encode(password.normalize("NFKC")), salt, { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32, onProgress });
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function createVault(mnemonic: string, password: string, accounts: PublicAccounts, pqSecret: Uint8Array, kdfParams = DEFAULT_KDF, onProgress?: (p: number) => void): Promise<VaultFile> {
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
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, new TextEncoder().encode(mnemonic));
  vault.ciphertext = b64(new Uint8Array(ct));
  vault.pqSignature = pqSign(pqSecret, canonicalJson({ ...vault, pqSignature: undefined }), "backup");
  return vault;
}

export async function openVault(v: VaultFile, password: string, onProgress?: (p: number) => void): Promise<string> {
  if (v.format !== "bajar-vault" || v.version > VAULT_VERSION) throw new Error("Unsupported vault format/version.");
  const key = await deriveKey(password, unb64(v.kdf.salt), v.kdf, onProgress);
  const aad = new TextEncoder().encode(canonicalJson({ ...v, ciphertext: undefined, pqSignature: undefined }));
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(v.cipher.iv), additionalData: aad }, key, unb64(v.ciphertext));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("Wrong password or corrupted vault.");
  }
}

/** Verify a backup file's ML-DSA-65 signature against its embedded PQ public key. */
export function verifyVaultSignature(v: VaultFile): boolean {
  if (!v.pqSignature) return false;
  return pqVerify(v.accounts.pq.publicKey, canonicalJson({ ...v, pqSignature: undefined }), v.pqSignature, "backup");
}

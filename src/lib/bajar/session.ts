"use client";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
/**
 * In-browser BAJAR keyring. Secret keys exist only in memory while unlocked and
 * are dropped on lock (auto-lock after inactivity). The encrypted vault lives
 * in localStorage. Nothing secret is ever sent over the network.
 */
import { deriveAll, normalizeMnemonic, pqSign, type PublicAccounts, type SecretKeys } from "./keys";
import { assertVaultShape, createVault, needsKdfUpgrade, openVault, verifyVaultSignature, type VaultFile, type VaultSecret } from "./vault";
import { passwordStrength, recordUnlockFailure, resetUnlockFailures, unlockBlockedFor } from "./security";
import { canonicalJson } from "./util";

const VAULT_KEY = "bajar.vault.v1";
const LOG_KEY = "bajar.authlog.v1";
const SETTINGS_KEY = "bajar.settings.v1";

interface Unlocked { pub: PublicAccounts; secret: SecretKeys }
let state: Unlocked | null = null;
let lockTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach((l) => l()); };

export interface BajarSettings {
  autoLockMinutes: number; evmChain: string;
  /** Set when the user proved they wrote the phrase down (quiz) or downloaded a backup. */
  backedUpAt?: string | null; backupMethod?: "phrase_quiz" | "file" | "imported" | null;
  passwordScore?: number; createdAt?: string;
}
const DEFAULT_SETTINGS: BajarSettings = { autoLockMinutes: 10, evmChain: "ethereum" };
export function settings(): BajarSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }; } catch { return { ...DEFAULT_SETTINGS }; }
}

/** Enforce the password policy for every NEW password (create, import, change). */
export function assertStrongPassword(pw: string, accounts?: PublicAccounts | null) {
  const r = passwordStrength(pw, accounts ? [accounts.evm.address, accounts.solana.address, accounts.bitcoin.address] : []);
  if (!r.ok) throw new Error(`Password too weak (${r.label}). ${r.issues[0] ?? ""}`.trim());
  return r;
}
export function saveSettings(s: Partial<BajarSettings>) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings(), ...s }));
  touch();
  emit();
}

export function loadVault(): VaultFile | null {
  try { const v = localStorage.getItem(VAULT_KEY); return v ? (JSON.parse(v) as VaultFile) : null; } catch { return null; }
}

function scheduleLock() {
  if (lockTimer) clearTimeout(lockTimer);
  if (state) lockTimer = setTimeout(lock, settings().autoLockMinutes * 60_000);
}

export function touch() { if (state) scheduleLock(); }

export const bajar = {
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  version: () => version,
  hasVault: () => !!loadVault(),
  isUnlocked: () => !!state,
  accounts: (): PublicAccounts | null => state?.pub ?? loadVault()?.accounts ?? null,
  secrets(): SecretKeys {
    if (!state) throw new Error("Bajar Wallet is locked. Unlock it to continue.");
    touch();
    return state.secret;
  },
};

function sameAccounts(a: PublicAccounts, b: PublicAccounts) {
  return a.evm.address === b.evm.address && a.bitcoin.address === b.bitcoin.address && a.solana.address === b.solana.address && a.pq.publicKey === b.pq.publicKey;
}

/** Encrypt and persist; `enforcePolicy` is false only when re-storing an existing password (restore/upgrade). */
const deriveFrom = (s: VaultSecret) => deriveAll(s.mnemonic, { passphrase: s.passphrase, solanaPath: s.solanaPath });

async function store(sec: VaultSecret, password: string, opts: { enforcePolicy: boolean; onProgress?: (p: number) => void; backup?: BajarSettings["backupMethod"] }): Promise<PublicAccounts> {
  const s: VaultSecret = { ...sec, mnemonic: normalizeMnemonic(sec.mnemonic) };
  const { pub, secret } = deriveFrom(s);
  const report = opts.enforcePolicy ? assertStrongPassword(password, pub) : null;
  const vault = await createVault(s, password, pub, secret.pq, undefined, opts.onProgress);
  // Read back and verify before switching over, so a storage glitch can't leave an unreadable vault.
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  const check = loadVault();
  if (!check || check.ciphertext !== vault.ciphertext) throw new Error("Could not save the encrypted wallet in this browser (storage full or blocked).");
  state = { pub, secret };
  const prev = settings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...prev,
    ...(report ? { passwordScore: report.score } : {}),
    ...(opts.backup ? { backedUpAt: new Date().toISOString(), backupMethod: opts.backup } : {}),
    createdAt: prev.createdAt ?? new Date().toISOString(),
  }));
  resetUnlockFailures();
  scheduleLock();
  emit();
  return pub;
}

/** New wallet (phrase generated here) or phrase import. `backup` records how the phrase was verified. */
export function createAndStore(mnemonic: string | VaultSecret, password: string, onProgress?: (p: number) => void, backup: BajarSettings["backupMethod"] = null) {
  // Starting a different wallet resets the backup status.
  try { const s = settings(); localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, backedUpAt: null, backupMethod: null, createdAt: undefined })); } catch { /* ignore */ }
  return store(typeof mnemonic === "string" ? { mnemonic } : mnemonic, password, { enforcePolicy: true, onProgress, backup });
}

export async function unlock(password: string, onProgress?: (p: number) => void) {
  const v = loadVault();
  if (!v) throw new Error("No Bajar Wallet on this device.");
  const wait = unlockBlockedFor();
  if (wait > 0) throw new Error(`Too many wrong passwords. Try again in ${Math.ceil(wait / 1000)}s.`);
  let sec: VaultSecret;
  try {
    sec = await openVault(v, password, onProgress);
  } catch (e) {
    const delay = recordUnlockFailure();
    throw new Error(`${(e as Error).message}${delay > 0 ? ` Locked for ${Math.ceil(delay / 1000)}s.` : ""}`);
  }
  const { pub, secret } = deriveFrom(sec);
  if (!sameAccounts(pub, v.accounts)) throw new Error("Vault accounts do not match the decrypted phrase — refusing to unlock.");
  resetUnlockFailures();
  state = { pub, secret };
  // Transparent upgrade of older/weaker encryption settings (same password).
  if (needsKdfUpgrade(v)) await store(sec, password, { enforcePolicy: false }).catch(() => {});
  scheduleLock();
  emit();
}

export const unlockWait = () => unlockBlockedFor();

export function lock() {
  if (state) {
    // Best-effort wipe of key material held in typed arrays.
    state.secret.bitcoin.fill(0); state.secret.solana.fill(0); state.secret.pq.fill(0);
  }
  state = null;
  if (lockTimer) clearTimeout(lockTimer);
  emit();
}

/** Re-decrypt to show the phrase (+ passphrase if any). Requires the password again. */
export async function revealMnemonic(password: string): Promise<VaultSecret> {
  const v = loadVault();
  if (!v) throw new Error("No wallet");
  const wait = unlockBlockedFor();
  if (wait > 0) throw new Error(`Too many wrong passwords. Try again in ${Math.ceil(wait / 1000)}s.`);
  try { const m = await openVault(v, password); resetUnlockFailures(); return m; } catch (e) { recordUnlockFailure(); throw e; }
}

export async function changePassword(oldPw: string, newPw: string) {
  if (oldPw === newPw) throw new Error("The new password must be different.");
  const m = await revealMnemonic(oldPw);
  await store(m, newPw, { enforcePolicy: true });
}

/** Mark the wallet as backed up (phrase quiz passed or encrypted file downloaded). */
export function markBackedUp(method: NonNullable<BajarSettings["backupMethod"]>) {
  saveSettings({ backedUpAt: new Date().toISOString(), backupMethod: method });
}

/** Encrypted, ML-DSA-65-signed backup file (still requires the password to open). */
export function exportBackup(): string {
  const v = loadVault();
  if (!v) throw new Error("No wallet");
  markBackedUp("file");
  return JSON.stringify(v, null, 2);
}

/**
 * Restore from an encrypted backup. Checks, in order: size and JSON shape,
 * safe KDF parameters, ML-DSA-65 signature, AES-GCM decryption (password),
 * and that the decrypted phrase derives exactly the addresses and PQ key in
 * the file (so swapped metadata can't trick you into using other addresses).
 */
export async function importBackup(json: string, password: string, onProgress?: (p: number) => void) {
  if (json.length > 20_000) throw new Error("File too large to be a Bajar backup.");
  let v: unknown;
  try { v = JSON.parse(json); } catch { throw new Error("Not valid JSON."); }
  assertVaultShape(v);
  if (!verifyVaultSignature(v)) throw new Error("Backup signature (ML-DSA-65) is invalid — the file was modified or corrupted.");
  const sec = await openVault(v, password, onProgress);
  const { pub } = deriveFrom(sec);
  if (!sameAccounts(pub, v.accounts)) throw new Error("Backup addresses do not match its encrypted phrase — refusing to restore.");
  try { const s = settings(); localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, createdAt: v.createdAt })); } catch { /* ignore */ }
  await store(sec, password, { enforcePolicy: false, backup: "file" });
}

export function removeWallet() {
  lock();
  localStorage.removeItem(VAULT_KEY);
  localStorage.removeItem(LOG_KEY);
  try { const s = settings(); localStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoLockMinutes: s.autoLockMinutes, evmChain: s.evmChain })); } catch { /* ignore */ }
  resetUnlockFailures();
  emit();
}

/* ---------------- Post-quantum authorization log ---------------- */

export interface AuthRecord { at: string; action: string; network: string; summary: string; digest: string; pqSignature: string; publicKeyFingerprint: string }

export function recordAuthorization(action: string, network: string, summary: string, payload: unknown): AuthRecord | null {
  if (!state) return null;
  const at = new Date().toISOString();
  const body = canonicalJson({ at, action, network, summary, payload });
  const rec: AuthRecord = { at, action, network, summary, digest: bytesToHex(sha256(new TextEncoder().encode(body))), pqSignature: pqSign(state.secret.pq, body, "authorize"), publicKeyFingerprint: state.pub.pq.fingerprint };
  try {
    const list = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]") as AuthRecord[];
    localStorage.setItem(LOG_KEY, JSON.stringify([rec, ...list].slice(0, 200)));
  } catch { /* storage full */ }
  return rec;
}

export function authLog(): AuthRecord[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]"); } catch { return []; }
}

if (typeof window !== "undefined") {
  ["pointerdown", "keydown"].forEach((ev) => window.addEventListener(ev, () => touch(), { passive: true }));
}

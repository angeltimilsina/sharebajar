"use client";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
/**
 * In-browser BAJAR keyring. Secret keys exist only in memory while unlocked and
 * are dropped on lock (auto-lock after inactivity). The encrypted vault lives
 * in localStorage. Nothing secret is ever sent over the network.
 */
import { deriveAll, normalizeMnemonic, pqSign, type PublicAccounts, type SecretKeys } from "./keys";
import { createVault, openVault, verifyVaultSignature, type VaultFile } from "./vault";
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

export interface BajarSettings { autoLockMinutes: number; evmChain: string }
export function settings(): BajarSettings {
  try { return { autoLockMinutes: 10, evmChain: "ethereum", ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }; } catch { return { autoLockMinutes: 10, evmChain: "ethereum" }; }
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
    if (!state) throw new Error("BAJAR Wallet is locked. Unlock it to continue.");
    touch();
    return state.secret;
  },
};

export async function createAndStore(mnemonic: string, password: string, onProgress?: (p: number) => void): Promise<PublicAccounts> {
  const { pub, secret } = deriveAll(normalizeMnemonic(mnemonic));
  const vault = await createVault(normalizeMnemonic(mnemonic), password, pub, secret.pq, undefined, onProgress);
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  state = { pub, secret };
  scheduleLock();
  emit();
  return pub;
}

export async function unlock(password: string, onProgress?: (p: number) => void) {
  const v = loadVault();
  if (!v) throw new Error("No BAJAR Wallet on this device.");
  const mnemonic = await openVault(v, password, onProgress);
  const { pub, secret } = deriveAll(mnemonic);
  if (pub.evm.address !== v.accounts.evm.address || pub.bitcoin.address !== v.accounts.bitcoin.address || pub.solana.address !== v.accounts.solana.address) {
    throw new Error("Vault accounts do not match the decrypted phrase — refusing to unlock.");
  }
  state = { pub, secret };
  scheduleLock();
  emit();
}

export function lock() {
  if (state) {
    // Best-effort wipe of key material held in typed arrays.
    state.secret.bitcoin.fill(0); state.secret.solana.fill(0); state.secret.pq.fill(0);
  }
  state = null;
  if (lockTimer) clearTimeout(lockTimer);
  emit();
}

/** Re-decrypt to show the phrase (requires the password again). */
export async function revealMnemonic(password: string): Promise<string> {
  const v = loadVault();
  if (!v) throw new Error("No wallet");
  return openVault(v, password);
}

export async function changePassword(oldPw: string, newPw: string) {
  const m = await revealMnemonic(oldPw);
  await createAndStore(m, newPw);
}

/** Encrypted, ML-DSA-65-signed backup file (still requires the password to open). */
export function exportBackup(): string {
  const v = loadVault();
  if (!v) throw new Error("No wallet");
  return JSON.stringify(v, null, 2);
}

export async function importBackup(json: string, password: string) {
  const v = JSON.parse(json) as VaultFile;
  if (v.format !== "bajar-vault") throw new Error("Not a BAJAR backup file.");
  if (!verifyVaultSignature(v)) throw new Error("Backup signature (ML-DSA-65) is invalid — the file was modified or corrupted.");
  const mnemonic = await openVault(v, password);
  await createAndStore(mnemonic, password);
}

export function removeWallet() {
  lock();
  localStorage.removeItem(VAULT_KEY);
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

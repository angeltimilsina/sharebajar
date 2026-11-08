import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Encryption + integrity for treasury configuration.
 *  - TREASURY_ENCRYPTION_KEY (32 bytes, hex or base64) is the master key.
 *  - Two sub-keys are derived with HKDF: one for AES-256-GCM, one for HMAC
 *    integrity seals over treasury records (detects database tampering such
 *    as a swapped receiving address).
 * This key protects configuration only — no wallet private keys exist anywhere.
 */
let cached: { enc: Buffer; mac: Buffer; ephemeral: boolean } | null = null;

function master(): { key: Buffer; ephemeral: boolean } {
  const raw = process.env.TREASURY_ENCRYPTION_KEY?.trim();
  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("TREASURY_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64).");
    return { key, ephemeral: false };
  }
  if (process.env.NODE_ENV === "production") throw new Error("TREASURY_ENCRYPTION_KEY is required in production.");
  // Development only: a local key file under .data/ (gitignored).
  const file = path.join(process.cwd(), ".data", "treasury-dev.key");
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return { key: Buffer.from(readFileSync(file, "utf8").trim(), "hex"), ephemeral: true };
}

function keys() {
  if (cached) return cached;
  const { key, ephemeral } = master();
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", key, Buffer.from("sharebajar-treasury"), Buffer.from(info), 32));
  cached = { enc: derive("config-encryption-v1"), mac: derive("record-integrity-v1"), ephemeral };
  return cached;
}

export const usingDevKey = () => keys().ephemeral;

export function encrypt(plain: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keys().enc, iv);
  const data = Buffer.concat([c.update(JSON.stringify(plain), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function decrypt<T>(blob: string | null | undefined): T | null {
  if (!blob) return null;
  const [v, iv, tag, data] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised ciphertext");
  const d = createDecipheriv("aes-256-gcm", keys().enc, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8")) as T;
}

/** Canonical JSON (sorted keys) so seals are stable. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function seal(fields: Record<string, unknown>): string {
  return createHmac("sha256", keys().mac).update(canonical(fields)).digest("hex");
}

export function verifySeal(fields: Record<string, unknown>, mac: string): boolean {
  const expected = Buffer.from(seal(fields), "hex");
  const got = Buffer.from(mac ?? "", "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Test helper */
export function __resetKeys() { cached = null; }

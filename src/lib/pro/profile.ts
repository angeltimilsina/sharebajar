import "server-only";
import { q, newId } from "@/lib/treasury/db";
import type { Session } from "@/lib/server/auth";
import { readSession } from "@/lib/server/gateway";
import { listTreasuries } from "@/lib/treasury/store";
import { PRO_COMP } from "@/lib/config/accounts";

/**
 * A profile belongs to a Bajar Wallet (created by its hybrid Ed25519 +
 * ML-DSA-65 sign-in). Other wallets join it with a one-time connection
 * token and a signed message proving control. Only public addresses are stored. Pro is a 30-day
 * plan paid in USDC on Solana to Bajar's verified treasury, checked on-chain.
 */
export const PRO = {
  priceUsdc: Math.max(1, Number(process.env.PRO_PRICE_USDC ?? 19)) || 19,
  periodDays: Math.max(1, Number(process.env.PRO_PERIOD_DAYS ?? 30)) || 30,
  /** Wallets that can be connected to one Bajar Wallet (same for every plan; Pro is the agent). */
  linkLimit: 10,
};
export const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type ChainType = "solana" | "evm";
export const normAddr = (chainType: ChainType, a: string) => (chainType === "evm" ? a.toLowerCase() : a);

/** The verified session (auth gateway). */
export async function currentSession(): Promise<Session | null> {
  return readSession();
}

/** The profile of the signed-in wallet, created on first use. */
export async function profileForSession(s: Session): Promise<string> {
  const addr = normAddr(s.chainType, s.address);
  const row = (await q<{ profile_id: string }>("select profile_id from profile_wallets where address = $1", [addr]))[0];
  if (row) return row.profile_id;
  const id = newId("prf");
  await q("insert into profiles (id) values ($1)", [id]);
  await q("insert into profile_wallets (address, profile_id, chain_type, label) values ($1,$2,$3,$4) on conflict (address) do nothing", [addr, id, s.chainType, "Sign-in wallet"]);
  // Lost a race with another request: use whichever profile won.
  return (await q<{ profile_id: string }>("select profile_id from profile_wallets where address = $1", [addr]))[0].profile_id;
}

export interface Plan { tier: "free" | "pro"; until: string | null; complimentary?: boolean }
export async function planOf(profileId: string): Promise<Plan> {
  // Complimentary Pro for addresses granted in code / PRO_COMP_ADDRESSES (testing before launch).
  const comp = new Set(PRO_COMP.map((a) => (a.startsWith("0x") ? a.toLowerCase() : a)));
  if (comp.size && (await walletsOf(profileId)).some((w) => comp.has(w.address))) return { tier: "pro", until: null, complimentary: true };
  const r = (await q<{ until: string | Date | null }>("select max(period_end) as until from subscriptions where profile_id = $1", [profileId]))[0];
  const until = r?.until ? new Date(r.until) : null;
  return until && until.getTime() > Date.now() ? { tier: "pro", until: until.toISOString() } : { tier: "free", until: until?.toISOString() ?? null };
}

export async function walletsOf(profileId: string) {
  return q<{ address: string; chain_type: ChainType; label: string | null; verified_at: string }>("select address, chain_type, label, verified_at from profile_wallets where profile_id = $1 order by verified_at", [profileId]);
}

export async function linkWallet(profileId: string, chainType: ChainType, address: string, label: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const addr = normAddr(chainType, address);
  const existing = (await q<{ profile_id: string }>("select profile_id from profile_wallets where address = $1", [addr]))[0];
  if (existing?.profile_id === profileId) return { ok: true };
  const count = (await walletsOf(profileId)).length;
  if (count >= PRO.linkLimit + 1) return { ok: false, error: `A Bajar Wallet can connect up to ${PRO.linkLimit} other wallets.` };
  if (existing) {
    // Signing in creates a profile for the wallet. If that profile is just this wallet (no other wallets, no plan,
    // no saved details or store logins, no orders), joining moves the wallet; otherwise it must be removed there first.
    const other = existing.profile_id;
    const [wallets, subs, shop, stores, orders] = await Promise.all([
      q<{ n: string | number }>("select count(*) as n from profile_wallets where profile_id=$1", [other]),
      q<{ n: string | number }>("select count(*) as n from subscriptions where profile_id=$1", [other]),
      q<{ n: string | number }>("select count(*) as n from shopping_profiles where profile_id=$1", [other]),
      q<{ n: string | number }>("select count(*) as n from store_accounts where profile_id=$1", [other]),
      q<{ n: string | number }>("select count(*) as n from commerce_orders where profile_id=$1", [other]),
    ]);
    const empty = Number(wallets[0]?.n) <= 1 && [subs, shop, stores, orders].every((r) => Number(r[0]?.n ?? 0) === 0);
    if (!empty) return { ok: false, error: "This wallet is already linked to another Bajar profile. Remove it there first." };
    await q("update profile_wallets set profile_id=$1, label=$2, verified_at=now() where address=$3 and profile_id=$4", [profileId, label, addr, other]);
    return { ok: true };
  }
  await q("insert into profile_wallets (address, profile_id, chain_type, label) values ($1,$2,$3,$4)", [addr, profileId, chainType, label]);
  return { ok: true };
}

export async function unlinkWallet(profileId: string, address: string, sessionAddr: string) {
  const a = address.startsWith("0x") ? address.toLowerCase() : address;
  if (a === (sessionAddr.startsWith("0x") ? sessionAddr.toLowerCase() : sessionAddr)) return { ok: false as const, error: "You can't remove the wallet you're signed in with." };
  await q("delete from profile_wallets where profile_id = $1 and address = $2", [profileId, a]);
  return { ok: true as const };
}

/** The verified, active Solana treasury that receives Pro payments (none = checkout closed). */
export async function proRecipient(): Promise<string | null> {
  try {
    const t = (await listTreasuries()).find((x) => x.chain === "solana" && x.status === "active" && x.integrityOk && x.ownership && x.environment === "mainnet" && x.kind !== "jupiter_referral");
    return t?.address ?? null;
  } catch {
    return null;
  }
}

/* ── Connection tokens ─────────────────────────────────────────────────── */

const TOKEN_TTL_MS = 15 * 60_000;
const sha256 = async (s: string) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).toString("hex");

/** A one-time token another wallet uses to join this Bajar Wallet. Only its hash is stored. */
export async function createConnectToken(profileId: string, bajarAddress: string) {
  const { default: bs58 } = await import("bs58");
  const token = bs58.encode(crypto.getRandomValues(new Uint8Array(24)));
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await q("delete from connect_tokens where expires_at < now() - interval '1 day'");
  await q("insert into connect_tokens (token_hash, profile_id, bajar_address, expires_at) values ($1,$2,$3,$4)", [await sha256(token), profileId, bajarAddress, expiresAt.toISOString()]);
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function peekConnectToken(token: string): Promise<{ bajarAddress: string; expiresAt: string } | null> {
  const r = (await q<{ bajar_address: string; expires_at: string | Date }>("select bajar_address, expires_at from connect_tokens where token_hash = $1 and used_at is null and expires_at > now()", [await sha256(token)]))[0];
  return r ? { bajarAddress: r.bajar_address, expiresAt: new Date(r.expires_at).toISOString() } : null;
}

/** Marks the token used (single use) and returns its profile, or null if expired/used. */
export async function consumeConnectToken(token: string): Promise<string | null> {
  const r = await q<{ profile_id: string }>("update connect_tokens set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning profile_id", [await sha256(token)]);
  return r[0]?.profile_id ?? null;
}

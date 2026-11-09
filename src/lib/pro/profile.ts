import "server-only";
import { cookies } from "next/headers";
import { q, newId } from "@/lib/treasury/db";
import { SESSION_COOKIE, unseal, type Session } from "@/lib/server/auth";
import { listTreasuries } from "@/lib/treasury/store";

/**
 * A Bajar profile groups wallets the user has proven they control (each one
 * signed a link message). Only public addresses are stored. Pro is a 30-day
 * plan paid in USDC on Solana to Bajar's verified treasury, checked on-chain.
 */
export const PRO = {
  priceUsdc: Math.max(1, Number(process.env.PRO_PRICE_USDC ?? 19)) || 19,
  periodDays: Math.max(1, Number(process.env.PRO_PERIOD_DAYS ?? 30)) || 30,
  limits: { free: 3, pro: 25 },
};
export const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type ChainType = "solana" | "evm";
export const normAddr = (chainType: ChainType, a: string) => (chainType === "evm" ? a.toLowerCase() : a);

export async function currentSession(): Promise<Session | null> {
  return unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value, "session");
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

export interface Plan { tier: "free" | "pro"; until: string | null }
export async function planOf(profileId: string): Promise<Plan> {
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
  if (existing) return { ok: false, error: "This wallet is already linked to another Bajar profile. Remove it there first." };
  const plan = await planOf(profileId);
  const count = (await walletsOf(profileId)).length;
  const limit = PRO.limits[plan.tier];
  if (count >= limit) return { ok: false, error: plan.tier === "free" ? `Free profiles can link ${limit} wallets. Upgrade to Pro to link up to ${PRO.limits.pro}.` : `Profiles can link up to ${limit} wallets.` };
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

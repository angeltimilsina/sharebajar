import "server-only";
import { cookies, headers } from "next/headers";
import { verifyEvm, verifySolana, type Session } from "../server/auth";
import { readSession } from "../server/gateway";
import { clientIp } from "../server/ratelimit";
import { q } from "./db";
import { alert, audit } from "./audit";
import { BOOTSTRAP_OWNERS } from "../config/accounts";

/**
 * Role-based access for /admin/treasury.
 *  viewer   – read-only monitoring (default for any granted admin)
 *  operator – run reconciliation, prepare (unsigned) initialisation transactions
 *  admin    – propose/approve configuration changes, build outgoing transfers
 *  owner    – manage admins; bootstrap via TREASURY_OWNERS env
 * Identity is a wallet signature (Sign-In with Solana/Ethereum); no passwords,
 * and no keys are ever handled by the server.
 */
export type Role = "viewer" | "operator" | "admin" | "owner";
export const RANK: Record<Role, number> = { viewer: 1, operator: 2, admin: 3, owner: 4 };

export interface Actor { address: string; chainType: "solana" | "evm"; role: Role; sessionAgeMs: number; source: "env" | "db" }

export class AccessError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

const norm = (a: string) => (a.startsWith("0x") ? a.toLowerCase() : a);

export function envOwners(): string[] {
  // TREASURY_OWNERS plus owners granted in code (src/lib/config/accounts.ts).
  return [...new Set([...(process.env.TREASURY_OWNERS ?? "").split(","), ...BOOTSTRAP_OWNERS].map((s) => s.trim()).filter(Boolean).map(norm))];
}

export const FRESH_MS = Number(process.env.TREASURY_FRESH_AUTH_MINUTES ?? 30) * 60_000;

export async function currentActor(): Promise<Actor | null> {
  // CSRF: a request initiated by another site never gets a treasury identity.
  const h = await headers();
  if (h.get("sec-fetch-site") === "cross-site") return null;
  const origin = h.get("origin");
  if (origin) {
    let oh: string | null = null;
    try { oh = new URL(origin).host; } catch { oh = null; }
    if (oh !== (h.get("x-forwarded-host") ?? h.get("host"))) return null;
  }
  const session = await readSession();
  if (!session) return null;
  const address = norm(session.address);
  const age = Date.now() - (session.iat ?? 0);
  if (envOwners().includes(address)) return { address, chainType: session.chainType, role: "owner", sessionAgeMs: age, source: "env" };
  const rows = await q<{ role: Role }>("select role from admins where address = $1", [address]);
  if (!rows[0]) return null;
  return { address, chainType: session.chainType, role: rows[0].role, sessionAgeMs: age, source: "db" };
}

const deniedRecently = new Map<string, number>();

/**
 * Gate an admin API call. `fresh` requires a wallet sign-in within
 * TREASURY_FRESH_AUTH_MINUTES (default 30) for sensitive operations.
 */
export async function requireRole(req: Request, min: Role, action: string, opts: { fresh?: boolean } = {}): Promise<Actor> {
  const ip = clientIp(req);
  const actor = await currentActor();
  if (!actor) {
    await audit({ action, outcome: "denied", details: { reason: "not signed in or not an admin" }, ip });
    const k = `${ip}:${action}`;
    if (Date.now() - (deniedRecently.get(k) ?? 0) > 60_000) {
      deniedRecently.set(k, Date.now());
      await alert("warning", "unauthorized_access", `Unauthorized treasury API access attempt (${action}) from ${ip}`);
    }
    throw new AccessError(401, "Sign in with an authorized admin wallet.");
  }
  if (RANK[actor.role] < RANK[min]) {
    await audit({ actor: actor.address, role: actor.role, action, outcome: "denied", details: { required: min }, ip });
    throw new AccessError(403, `This action requires the ${min} role.`);
  }
  if (opts.fresh && actor.sessionAgeMs > FRESH_MS) {
    await audit({ actor: actor.address, role: actor.role, action, outcome: "denied", details: { reason: "stale session" }, ip });
    throw new AccessError(401, "Please sign in with your wallet again to perform this action.");
  }
  return actor;
}

/** Verify that the actor's own wallet signed `message` (action-level signatures). */
export function verifyActorSignature(actor: Actor, message: string, signature: string): boolean {
  return actor.chainType === "solana" ? verifySolana(message, signature, actor.address) : verifyEvm(message, signature, actor.address);
}

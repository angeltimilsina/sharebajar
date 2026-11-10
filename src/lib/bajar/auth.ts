"use client";
import { bajar } from "./session";
import { pqSign, solanaSign } from "./keys";
import { requestApproval } from "./approvals";

export interface BajarSession { address: string; chainType: string; exp: number; iat?: number; pq?: { alg: string; fingerprint: string } }

/** Current server session (httpOnly cookie, read via the API). */
export async function currentSession(): Promise<BajarSession | null> {
  try { return (await (await fetch("/api/auth/session", { cache: "no-store" })).json()).session ?? null; } catch { return null; }
}

/**
 * Hybrid sign-in: the server issues a one-time challenge bound to this
 * domain, your Solana address and your ML-DSA-65 key fingerprint. You approve
 * it, Bajar signs it with Ed25519 AND ML-DSA-65 locally, and the server
 * verifies both before issuing an httpOnly session cookie. No keys leave the
 * browser; the signature can't be replayed (single-use nonce, 5-minute expiry).
 */
export async function hybridSignIn(): Promise<BajarSession> {
  const a = bajar.accounts();
  if (!a || !bajar.isUnlocked()) throw new Error("Unlock Bajar Wallet first.");
  const r = await fetch(`/api/auth/nonce?chainType=solana&address=${a.solana.address}&pqPublicKey=${encodeURIComponent(a.pq.publicKey)}`, { cache: "no-store" });
  const n = await r.json();
  if (!r.ok || !n.message) throw new Error(n.error ?? "Could not start sign-in");
  // Defence in depth: refuse to sign a challenge for another site or address.
  const msg: string = n.message;
  if (!msg.startsWith(`${window.location.host} wants you to sign in`) || !msg.includes(a.solana.address) || !msg.includes(a.pq.fingerprint)) {
    throw new Error("Sign-in challenge does not match this site or wallet — not signing.");
  }
  const ok = await requestApproval({ kind: "message", network: "Bajar", title: "Sign in (Ed25519 + ML-DSA-65)", rows: [["Site", window.location.host], ["Account", a.solana.address], ["PQ key", a.pq.fingerprint]], raw: msg }, { message: msg });
  if (!ok) throw new Error("Sign-in cancelled.");
  const s = bajar.secrets();
  const v = await fetch("/api/auth/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ signature: solanaSign(s.solana, msg), pqSignature: pqSign(s.pq, msg, "auth"), pqPublicKey: a.pq.publicKey }),
  });
  const b = await v.json();
  if (!v.ok) throw new Error(b.error ?? "Sign-in failed");
  window.dispatchEvent(new Event("bajar:session"));
  return b.session as BajarSession;
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.dispatchEvent(new Event("bajar:session"));
}

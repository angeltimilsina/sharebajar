import "server-only";
import { q, newId } from "./db";
import { canonical, decrypt, encrypt, sha256 } from "./crypto";
import { audit, alert } from "./audit";
import { verifyActorSignature, type Actor } from "./access";
import { TreasuryError } from "./http";

/**
 * Dual control for sensitive configuration changes (registering receiving
 * addresses, changing fee configuration, activating fee collection, admin
 * management). Each change is signed by the requester's wallet and must be
 * approved — also with a wallet signature — by a different admin before it
 * takes effect. TREASURY_REQUIRED_APPROVALS (default 2) counts the requester.
 */
export type ChangeAction = "register_treasury" | "update_fees" | "activate" | "grant_role" | "revoke_role";

export const REQUIRED_APPROVALS = Math.max(1, Number(process.env.TREASURY_REQUIRED_APPROVALS ?? 2));
const MAX_SIG_AGE_MS = 10 * 60_000;

export function requestMessage(action: ChangeAction, payloadHash: string, requester: string, issuedAt: string) {
  return [
    "Bajar Treasury — change request",
    `Action: ${action}`,
    `Payload SHA-256: ${payloadHash}`,
    `Requested by: ${requester}`,
    `Issued At: ${issuedAt}`,
    "This signature authorises a configuration change only. It does not move funds.",
  ].join("\n");
}

export function approvalMessage(id: string, payloadHash: string, approver: string) {
  return ["Bajar Treasury — approval", `Change: ${id}`, `Payload SHA-256: ${payloadHash}`, `Approver: ${approver}`, "This signature approves a configuration change only. It does not move funds."].join("\n");
}

export const payloadHash = (action: ChangeAction, payload: unknown) => sha256(canonical({ action, payload }));

export interface ChangeRequest {
  id: string; treasuryId: string | null; action: ChangeAction; payload: Record<string, unknown>; payloadHash: string; status: string;
  requestedBy: string; approvals: { approver: string; signature: string; at: string }[]; reason: string | null; createdAt: string; decidedAt: string | null;
}

interface Row { id: string; treasury_id: string | null; action: string; payload: string; payload_hash: string; status: string; requested_by: string; requester_signature: string; approvals: string; reason: string | null; created_at: string | Date; decided_at: string | Date | null }
const hydrate = (r: Row): ChangeRequest => ({
  id: r.id, treasuryId: r.treasury_id, action: r.action as ChangeAction, payload: decrypt<Record<string, unknown>>(r.payload) ?? {}, payloadHash: r.payload_hash,
  status: r.status, requestedBy: r.requested_by, approvals: JSON.parse(r.approvals), reason: r.reason,
  createdAt: new Date(r.created_at).toISOString(), decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
});

export async function listChanges(limit = 50): Promise<ChangeRequest[]> {
  return (await q<Row>("select * from change_requests order by created_at desc limit $1", [limit])).map(hydrate);
}

export async function getChange(id: string) {
  const [r] = await q<Row>("select * from change_requests where id = $1", [id]);
  return r ? hydrate(r) : null;
}

type Applier = (c: ChangeRequest, actor: Actor) => Promise<void>;

export async function createChange(actor: Actor, action: ChangeAction, payload: Record<string, unknown>, issuedAt: string, signature: string, apply: Applier, treasuryId?: string) {
  const age = Date.now() - Date.parse(issuedAt);
  if (!(age >= -60_000 && age < MAX_SIG_AGE_MS)) throw new TreasuryError(400, "Signature request expired — please sign again.");
  const hash = payloadHash(action, payload);
  if (!verifyActorSignature(actor, requestMessage(action, hash, actor.address, issuedAt), signature)) {
    await audit({ actor: actor.address, role: actor.role, action: `change.${action}`, outcome: "denied", details: { reason: "bad signature" } });
    throw new TreasuryError(401, "Wallet signature did not verify.");
  }
  const id = newId("chg");
  await q(
    "insert into change_requests (id, treasury_id, action, payload, payload_hash, requested_by, requester_signature) values ($1,$2,$3,$4,$5,$6,$7)",
    [id, treasuryId ?? (payload.treasuryId as string) ?? null, action, encrypt(payload), hash, actor.address, signature],
  );
  await audit({ actor: actor.address, role: actor.role, action: `change.${action}`, target: id, outcome: "pending", details: { payloadHash: hash } });
  await alert("info", "change_requested", `${actor.address} requested "${action}" (${id}). ${REQUIRED_APPROVALS > 1 ? `Needs ${REQUIRED_APPROVALS - 1} more approval(s).` : "Single-approver mode: applied immediately."}`);
  const c = (await getChange(id))!;
  if (REQUIRED_APPROVALS <= 1) await finalize(c, actor, apply);
  return (await getChange(id))!;
}

export async function approveChange(actor: Actor, id: string, signature: string, apply: Applier) {
  const c = await getChange(id);
  if (!c) throw new TreasuryError(404, "Change request not found");
  if (c.status !== "pending") throw new TreasuryError(409, `Change is already ${c.status}`);
  if (c.requestedBy === actor.address || c.approvals.some((a) => a.approver === actor.address)) throw new TreasuryError(403, "A different admin must approve this change.");
  if (!verifyActorSignature(actor, approvalMessage(id, c.payloadHash, actor.address), signature)) throw new TreasuryError(401, "Approval signature did not verify.");
  const approvals = [...c.approvals, { approver: actor.address, signature, at: new Date().toISOString() }];
  await q("update change_requests set approvals = $2 where id = $1", [id, JSON.stringify(approvals)]);
  await audit({ actor: actor.address, role: actor.role, action: `change.approve`, target: id, outcome: "ok" });
  const updated = (await getChange(id))!;
  if (approvals.length + 1 >= REQUIRED_APPROVALS) await finalize(updated, actor, apply);
  return (await getChange(id))!;
}

async function finalize(c: ChangeRequest, actor: Actor, apply: Applier) {
  // Re-check payload integrity before applying.
  if (payloadHash(c.action, c.payload) !== c.payloadHash) {
    await q("update change_requests set status='rejected', reason='payload hash mismatch', decided_at=now() where id=$1", [c.id]);
    await alert("critical", "integrity_failure", `Change ${c.id} payload hash mismatch — rejected.`);
    throw new TreasuryError(409, "Change payload failed integrity check.");
  }
  try {
    await apply(c, actor);
    await q("update change_requests set status='applied', decided_at=now() where id=$1", [c.id]);
    await audit({ actor: actor.address, role: actor.role, action: `change.apply.${c.action}`, target: c.id, outcome: "ok" });
    await alert("warning", "change_applied", `Treasury change "${c.action}" (${c.id}) was applied.`);
  } catch (e) {
    await q("update change_requests set status='failed', reason=$2, decided_at=now() where id=$1", [c.id, String(e instanceof Error ? e.message : e).slice(0, 300)]);
    await audit({ actor: actor.address, role: actor.role, action: `change.apply.${c.action}`, target: c.id, outcome: "error", details: { error: String(e) } });
    throw e;
  }
}

export async function rejectChange(actor: Actor, id: string, reason: string) {
  const c = await getChange(id);
  if (!c || c.status !== "pending") throw new TreasuryError(409, "Only pending changes can be rejected");
  await q("update change_requests set status='rejected', reason=$2, decided_at=now() where id=$1", [id, reason.slice(0, 300)]);
  await audit({ actor: actor.address, role: actor.role, action: "change.reject", target: id, outcome: "ok", details: { reason } });
}

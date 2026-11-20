import { z } from "zod";
import { requireRole } from "@/lib/treasury/access";
import { handle, TreasuryError } from "@/lib/treasury/http";
import { body } from "@/lib/treasury/body";
import { createChange, listChanges, payloadHash, requestMessage, REQUIRED_APPROVALS, type ChangeAction } from "@/lib/treasury/governance";
import { applyChange, invalidateCandidates } from "@/lib/treasury/service";

const Action = z.enum(["register_treasury", "update_fees", "activate", "grant_role", "revoke_role"]);
const Create = z.object({ action: Action, payload: z.record(z.string(), z.unknown()), issuedAt: z.string(), signature: z.string().min(40).max(200), prepare: z.literal(false).optional() });
const Prepare = z.object({ action: Action, payload: z.record(z.string(), z.unknown()), prepare: z.literal(true) });

const OWNER_ACTIONS: ChangeAction[] = ["grant_role", "revoke_role"];

export async function GET(req: Request) {
  return handle(async () => {
    await requireRole(req, "viewer", "change.list");
    return { changes: await listChanges(), requiredApprovals: REQUIRED_APPROVALS };
  });
}

/**
 * POST { prepare: true, action, payload }  → message to sign
 * POST { action, payload, issuedAt, signature } → create signed change request
 */
export async function POST(req: Request) {
  return handle(async () => {
    const raw = await req.clone().json().catch(() => ({}));
    if (raw?.prepare === true) {
      const b = await body(req, Prepare);
      const actor = await requireRole(req, OWNER_ACTIONS.includes(b.action) ? "owner" : "admin", `change.prepare.${b.action}`);
      const issuedAt = new Date().toISOString();
      return { message: requestMessage(b.action, payloadHash(b.action, b.payload), actor.address, issuedAt), issuedAt, payloadHash: payloadHash(b.action, b.payload) };
    }
    const b = await body(req, Create);
    const actor = await requireRole(req, OWNER_ACTIONS.includes(b.action) ? "owner" : "admin", `change.create.${b.action}`, { fresh: true });
    if (b.action === "register_treasury" && !b.payload.expectedReceivingAddress) throw new TreasuryError(400, "Inspect the address before registering.");
    const c = await createChange(actor, b.action, b.payload, b.issuedAt, b.signature, async (ch, a) => { await applyChange(ch, a); invalidateCandidates(); });
    return { change: c };
  });
}

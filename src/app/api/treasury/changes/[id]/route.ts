import { z } from "zod";
import { requireRole } from "@/lib/treasury/access";
import { handle, TreasuryError } from "@/lib/treasury/http";
import { body } from "@/lib/treasury/body";
import { approvalMessage, approveChange, getChange, rejectChange } from "@/lib/treasury/governance";
import { applyChange, invalidateCandidates } from "@/lib/treasury/service";

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("message") }),
  z.object({ op: z.literal("approve"), signature: z.string().min(40).max(200) }),
  z.object({ op: z.literal("reject"), reason: z.string().min(3).max(300) }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const b = await body(req, Body);
    const c = await getChange(id);
    if (!c) throw new TreasuryError(404, "Change request not found");
    const min = c.action === "grant_role" || c.action === "revoke_role" ? "owner" : "admin";
    if (b.op === "message") {
      const actor = await requireRole(req, min, "change.approval-message");
      return { message: approvalMessage(id, c.payloadHash, actor.address), payload: c.payload, action: c.action };
    }
    if (b.op === "approve") {
      const actor = await requireRole(req, min, "change.approve", { fresh: true });
      return { change: await approveChange(actor, id, b.signature, async (ch, a) => { await applyChange(ch, a); invalidateCandidates(); }) };
    }
    const actor = await requireRole(req, "admin", "change.reject");
    await rejectChange(actor, id, b.reason);
    return { ok: true };
  });
}

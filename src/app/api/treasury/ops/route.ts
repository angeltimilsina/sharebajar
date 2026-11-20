import { z } from "zod";
import { requireRole } from "@/lib/treasury/access";
import { handle, TreasuryError } from "@/lib/treasury/http";
import { body } from "@/lib/treasury/body";
import { getTreasury } from "@/lib/treasury/store";
import { buildConvertToUsdc, buildTransfer } from "@/lib/treasury/ops";
import { audit, alert } from "@/lib/treasury/audit";

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("transfer"), treasuryId: z.string(), toTreasuryId: z.string(), token: z.string().min(32).max(44), amount: z.string().max(40) }),
  z.object({ op: z.literal("convert"), treasuryId: z.string(), token: z.string().min(32).max(44), amount: z.string().max(40) }),
]);

/** Build (never sign/send) outgoing treasury transactions. Admin + fresh sign-in. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req, Body);
    const actor = await requireRole(req, "admin", `ops.${b.op}`, { fresh: true });
    const t = await getTreasury(b.treasuryId);
    if (!t) throw new TreasuryError(404, "Treasury not found");
    if (!t.integrityOk) throw new TreasuryError(409, "Treasury failed its integrity check.");
    const r = b.op === "transfer" ? await buildTransfer(t, b.toTreasuryId, b.token, b.amount) : await buildConvertToUsdc(t, b.token, b.amount);
    await audit({ actor: actor.address, role: actor.role, action: `ops.${b.op}.prepared`, target: t.id, outcome: "ok", details: { summary: r.summary, kind: r.kind } });
    await alert("info", "operation_prepared", `${actor.address} prepared: ${r.summary}. Requires treasury signer approval to execute.`);
    return r;
  });
}

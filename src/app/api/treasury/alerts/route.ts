import { z } from "zod";
import { requireRole } from "@/lib/treasury/access";
import { handle } from "@/lib/treasury/http";
import { body } from "@/lib/treasury/body";
import { q } from "@/lib/treasury/db";
import { audit } from "@/lib/treasury/audit";

export async function GET(req: Request) {
  return handle(async () => {
    await requireRole(req, "viewer", "alerts.view");
    return { alerts: await q("select * from alerts order by id desc limit 200") };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireRole(req, "operator", "alerts.ack");
    const b = await body(req, z.object({ id: z.number().int() }));
    await q("update alerts set acknowledged_by=$2, acknowledged_at=now() where id=$1", [b.id, actor.address]);
    await audit({ actor: actor.address, role: actor.role, action: "alerts.ack", target: String(b.id), outcome: "ok" });
    return { ok: true };
  });
}

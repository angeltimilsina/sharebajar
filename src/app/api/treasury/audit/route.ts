import { requireRole } from "@/lib/treasury/access";
import { handle } from "@/lib/treasury/http";
import { q } from "@/lib/treasury/db";

export async function GET(req: Request) {
  return handle(async () => {
    await requireRole(req, "viewer", "audit.view");
    return { entries: await q("select * from audit_log order by id desc limit 300"), admins: await q("select address, chain_type, role, label, added_by, created_at from admins order by created_at") };
  });
}

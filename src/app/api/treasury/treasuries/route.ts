import { requireRole } from "@/lib/treasury/access";
import { handle } from "@/lib/treasury/http";
import { listTreasuries } from "@/lib/treasury/store";

export async function GET(req: Request) {
  return handle(async () => {
    await requireRole(req, "viewer", "treasury.list");
    return { treasuries: await listTreasuries() };
  });
}

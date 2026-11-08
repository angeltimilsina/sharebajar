import { requireRole } from "@/lib/treasury/access";
import { handle } from "@/lib/treasury/http";
import { runIndexer } from "@/lib/treasury/engine";

export const maxDuration = 300;

/** Manual reconciliation run (operator+). */
export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireRole(req, "operator", "indexer.manual");
    const u = new URL(req.url);
    const id = u.searchParams.get("treasury") ?? undefined;
    return { summary: await runIndexer({ treasuryId: id, actor: actor.address, rescan: u.searchParams.get("rescan") === "1" }) };
  });
}

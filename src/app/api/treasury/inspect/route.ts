import { z } from "zod";
import { requireRole } from "@/lib/treasury/access";
import { handle } from "@/lib/treasury/http";
import { body } from "@/lib/treasury/body";
import { adapterFor } from "@/lib/treasury/adapters";

const Body = z.object({ chain: z.string(), environment: z.enum(["mainnet", "testnet"]).default("mainnet"), kind: z.enum(["wallet", "safe", "squads", "jupiter_referral"]), address: z.string().min(20).max(64), vaultIndex: z.number().int().min(0).max(255).optional() });

/** Read-only on-chain inspection used by the setup wizard before registering. */
export async function POST(req: Request) {
  return handle(async () => {
    await requireRole(req, "admin", "treasury.inspect");
    const b = await body(req, Body);
    const a = adapterFor(b.chain);
    if (!a.kinds.includes(b.kind)) return { ok: false, receivingAddress: b.address, facts: {}, warnings: [], errors: [`${b.kind} is not available on this network.`] };
    return a.inspect(b);
  });
}

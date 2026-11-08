import { z } from "zod";
import { requireRole } from "@/lib/treasury/access";
import { handle, TreasuryError } from "@/lib/treasury/http";
import { body } from "@/lib/treasury/body";
import { getTreasury, updateTreasury } from "@/lib/treasury/store";
import { adapterFor } from "@/lib/treasury/adapters";
import { buildInitTokenAccountsTx } from "@/lib/treasury/adapters/solana";
import { latestValidation, runValidation, invalidateCandidates } from "@/lib/treasury/service";
import { liveQuoteCheck } from "@/lib/treasury/swaps";
import { audit, alert } from "@/lib/treasury/audit";
import { q } from "@/lib/treasury/db";
import { ownershipMessage } from "@/lib/treasury/messages";

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("ownership-message") }),
  z.object({ op: z.literal("verify-ownership"), signer: z.string().min(20).max(64), message: z.string().max(2000), signature: z.string().min(40).max(200) }),
  z.object({ op: z.literal("init-accounts-tx"), payer: z.string().min(32).max(44) }),
  z.object({ op: z.literal("check-accounts") }),
  z.object({ op: z.literal("validate") }),
  z.object({ op: z.literal("set-status"), status: z.enum(["testing", "disabled", "verified"]) }),
]);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireRole(req, "viewer", "treasury.get");
    const { id } = await params;
    const t = await getTreasury(id);
    if (!t) throw new TreasuryError(404, "Treasury not found");
    const [intents] = await q<{ n: string }>("select count(*)::text as n from swap_intents where treasury_id=$1 and is_test", [id]);
    const tests = await q("select id, tx_hash, status, amount, token_symbol, reconciliation, block_time from revenue_events where treasury_id=$1 and is_test order by block_time desc limit 10", [id]);
    return { treasury: t, validation: await latestValidation(id), testIntents: Number(intents?.n ?? 0), testRevenue: tests };
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const b = await body(req, Body);
    const t = await getTreasury(id);
    if (!t) throw new TreasuryError(404, "Treasury not found");
    switch (b.op) {
      case "ownership-message": {
        await requireRole(req, "admin", "treasury.ownership-message");
        const issuedAt = new Date().toISOString();
        return { message: ownershipMessage(t, issuedAt), issuedAt };
      }
      case "verify-ownership": {
        const actor = await requireRole(req, "admin", "treasury.verify-ownership", { fresh: true });
        const m = b.message.match(/Issued At: (.+)/);
        const age = m ? Date.now() - Date.parse(m[1]) : Infinity;
        if (!(age >= -60_000 && age < 10 * 60_000)) throw new TreasuryError(400, "Ownership message expired — request a new one.");
        if (b.message !== ownershipMessage(t, m![1])) throw new TreasuryError(400, "Message does not match the expected ownership statement.");
        const r = await adapterFor(t.chain).verifyOwnership(t, b.signer, b.message, b.signature);
        await audit({ actor: actor.address, role: actor.role, action: "treasury.verify-ownership", target: id, outcome: r.ok ? "ok" : "denied", details: r });
        if (!r.ok) throw new TreasuryError(400, r.detail);
        const updated = await updateTreasury(id, { ownership: { method: r.method, signer: b.signer, message: b.message, signature: b.signature, verifiedAt: new Date().toISOString(), detail: r.detail }, status: t.status === "registered" ? "verified" : t.status });
        return { treasury: updated, result: r };
      }
      case "init-accounts-tx": {
        const actor = await requireRole(req, "operator", "treasury.init-accounts");
        if (t.chainType !== "solana") throw new TreasuryError(400, "Token account initialization only applies to Solana.");
        const r = await buildInitTokenAccountsTx(t, b.payer);
        await audit({ actor: actor.address, role: actor.role, action: "treasury.init-accounts-tx", target: id, outcome: "ok", details: { created: r.created, simulationError: r.simulation.err } });
        return r;
      }
      case "check-accounts": {
        await requireRole(req, "operator", "treasury.check-accounts");
        const accounts = await adapterFor(t.chain).checkFeeAccounts(t);
        await updateTreasury(id, { inspection: { ...(t.inspection ?? {}), feeAccounts: accounts, feeAccountsCheckedAt: new Date().toISOString() } });
        invalidateCandidates();
        return { accounts };
      }
      case "validate": {
        const actor = await requireRole(req, "operator", "treasury.validate");
        return { results: await runValidation(t, actor, liveQuoteCheck), treasury: await getTreasury(id) };
      }
      case "set-status": {
        const actor = await requireRole(req, "admin", `treasury.set-status.${b.status}`, { fresh: b.status !== "disabled" });
        if (b.status === "testing" && !["validated", "testing"].includes(t.status)) throw new TreasuryError(409, "Validate the treasury before testing.");
        if (b.status === "verified" && t.status !== "disabled") throw new TreasuryError(409, "Only a disabled treasury can be re-enabled.");
        const updated = await updateTreasury(id, { status: b.status });
        invalidateCandidates();
        await audit({ actor: actor.address, role: actor.role, action: `treasury.status.${b.status}`, target: id, outcome: "ok" });
        if (b.status === "disabled") await alert("warning", "treasury_disabled", `${actor.address} disabled fee collection for ${t.label}.`);
        return { treasury: updated };
      }
    }
  });
}

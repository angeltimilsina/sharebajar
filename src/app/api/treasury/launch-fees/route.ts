import { z } from "zod";
import { q } from "@/lib/treasury/db";
import { requireRole } from "@/lib/treasury/access";
import { audit, alert } from "@/lib/treasury/audit";
import { handle, TreasuryError } from "@/lib/treasury/http";
import { clientIp } from "@/lib/server/ratelimit";
import { feeSchedule, launchFeePlan, launchFeeSettings, parseSchedule } from "@/lib/launch/fees";
import { isSolanaAddress } from "@/lib/treasury/solana";

const Body = z.object({
  schedule: z.string().max(60),
  solanaRecipient: z.string().max(60).optional().or(z.literal("")),
  evmRecipient: z.string().max(60).optional().or(z.literal("")),
});

/** Launch fee settings: how much per number of networks, and where fees are paid. */
export async function GET(req: Request) {
  return handle(async () => {
    await requireRole(req, "viewer", "launch-fees.read");
    const [settings, plan] = await Promise.all([launchFeeSettings(), launchFeePlan(["solana", "ethereum", "base", "bsc"])]);
    return { settings: { ...settings, schedule: settings.schedule ?? feeSchedule(), fromEnv: !settings.schedule }, preview: plan };
  });
}

/** Owners only, with a recent sign-in: changing where fees go is sensitive, so it's audited and alerted. */
export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireRole(req, "owner", "launch-fees.update", { fresh: true });
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success) throw new TreasuryError(400, "Invalid settings");
    const schedule = parseSchedule(p.data.schedule);
    if (!schedule) throw new TreasuryError(400, "Schedule: four non-decreasing USDC amounts for 1, 2, 3 and 4 networks (e.g. 1,2,3,4).");
    const sol = p.data.solanaRecipient?.trim() || null, evm = p.data.evmRecipient?.trim() || null;
    if (sol && !isSolanaAddress(sol)) throw new TreasuryError(400, "Solana fee address isn't a valid Solana address.");
    if (evm && !/^0x[0-9a-fA-F]{40}$/.test(evm)) throw new TreasuryError(400, "EVM fee address isn't a valid 0x address.");
    const before = await launchFeeSettings();
    await q(
      `insert into launch_fee_settings (id, schedule, solana_recipient, evm_recipient, updated_by, updated_at) values ('default',$1,$2,$3,$4, now())
       on conflict (id) do update set schedule = excluded.schedule, solana_recipient = excluded.solana_recipient, evm_recipient = excluded.evm_recipient, updated_by = excluded.updated_by, updated_at = now()`,
      [schedule.join(","), sol, evm, actor.address],
    );
    await audit({ actor: actor.address, role: actor.role, action: "launch-fees.update", outcome: "ok", details: { before, after: { schedule, solanaRecipient: sol, evmRecipient: evm } }, ip: clientIp(req) });
    if (before.solanaRecipient !== sol || before.evmRecipient !== evm) await alert("warning", "launch_fee_recipient_changed", `Launch fee address changed by ${actor.address}`, { solana: sol, evm });
    return { ok: true };
  });
}

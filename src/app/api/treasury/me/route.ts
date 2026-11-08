import { currentActor, envOwners, FRESH_MS } from "@/lib/treasury/access";
import { REQUIRED_APPROVALS } from "@/lib/treasury/governance";
import { handle } from "@/lib/treasury/http";
import { db } from "@/lib/treasury/db";
import { usingDevKey } from "@/lib/treasury/crypto";
import { DEFAULT_FEE_BPS, MAX_FEE_BPS, PROVIDER_RULES } from "@/lib/treasury/fees";
import { zeroXConfigured } from "@/lib/trading/zerox";
import { CROSS_CHAIN_FEE_BPS } from "@/lib/trading/lifi";
import { LAUNCH_FEE } from "@/lib/treasury/fees";

export async function GET() {
  return handle(async () => {
    const actor = await currentActor();
    const d = await db();
    let devKey = false;
    try { devKey = usingDevKey(); } catch { /* reported below */ }
    return {
      actor: actor ? { address: actor.address, role: actor.role, chainType: actor.chainType, fresh: actor.sessionAgeMs < FRESH_MS, source: actor.source } : null,
      config: {
        requiredApprovals: REQUIRED_APPROVALS, ownersConfigured: envOwners().length, database: d.kind, devEncryptionKey: devKey,
        defaultFeeBps: DEFAULT_FEE_BPS, maxFeeBps: MAX_FEE_BPS, rules: PROVIDER_RULES, crossChainFeeBps: CROSS_CHAIN_FEE_BPS, launchFee: LAUNCH_FEE,
        jupiterApiKey: !!process.env.JUPITER_API_KEY, zeroXApiKey: zeroXConfigured(), alertWebhook: !!process.env.TREASURY_ALERT_WEBHOOK_URL,
        cron: !!process.env.CRON_SECRET, freshMinutes: FRESH_MS / 60_000,
      },
    };
  });
}

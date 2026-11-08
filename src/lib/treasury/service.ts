import "server-only";
import { treasuryChain } from "./chainInfo";
import { CROSS_CHAIN_FEE_BPS } from "../trading/lifi";
import { q } from "./db";
import { adapterFor } from "./adapters";
import { audit } from "./audit";
import { envOwners, type Actor, type Role } from "./access";
import { checkFeeBps, DEFAULT_FEE_BPS, type FeeCandidate, type RuleKey } from "./fees";
import { getTreasury, insertTreasury, listTreasuries, updateTreasury, type FeeConfig, type FeeToken, type Treasury, type TreasuryKind } from "./store";
import type { ChangeRequest } from "./governance";
import { TreasuryError } from "./http";

/* ------------------------------------------------------------------ */
/* Fee configuration                                                   */
/* ------------------------------------------------------------------ */

export interface FeeConfigInput { feeBps?: number; tokens: string[]; crossChainFeeBps?: number; preferUsdc?: boolean }

/** Validate a fee configuration against provider rules and on-chain token data. */
export async function buildFeeConfig(t: Treasury, input: FeeConfigInput): Promise<FeeConfig> {
  const adapter = adapterFor(t.chain);
  const provider = t.chainType === "bitcoin" ? "lifi" : t.chainType === "solana" ? "jupiter" : "0x";
  const mode = t.chainType === "bitcoin" ? "cross_chain" : t.kind === "jupiter_referral" ? "referral" : t.chainType === "solana" ? "platform" : "integrator";
  const key = `${provider}:${mode}` as RuleKey;
  const feeBps = input.feeBps ?? (mode === "referral" ? Math.max(50, DEFAULT_FEE_BPS) : mode === "cross_chain" ? CROSS_CHAIN_FEE_BPS : DEFAULT_FEE_BPS);
  const err = checkFeeBps(key, feeBps);
  if (err) throw new TreasuryError(400, err);
  const crossChainFeeBps = mode === "cross_chain" ? feeBps : (input.crossChainFeeBps ?? CROSS_CHAIN_FEE_BPS);
  const xerr = checkFeeBps("lifi:cross_chain", crossChainFeeBps);
  if (xerr) throw new TreasuryError(400, xerr);
  if (mode === "cross_chain") input = { ...input, tokens: ["bitcoin"] };
  const unique = [...new Set(input.tokens.map((s) => s.trim()).filter(Boolean))];
  if (!unique.length) throw new TreasuryError(400, "Select at least one fee token.");
  if (unique.length > 12) throw new TreasuryError(400, "At most 12 fee tokens.");
  const tokens: FeeToken[] = [];
  for (const token of unique) {
    if (!adapter.validAddress(token) && !(t.chainType === "bitcoin" && token === "bitcoin")) throw new TreasuryError(400, `Invalid token address ${token}`);
    const info = await adapter.tokenInfo(t.chain, token, t.environment);
    if (!info) throw new TreasuryError(400, `${token} is not a valid ${t.chainType === "evm" ? "ERC-20 contract (native coins can't be used as fee tokens)" : "SPL token mint"} on ${treasuryChain(t.chain)?.name}.`);
    tokens.push({ token, symbol: info.symbol, decimals: info.decimals, tokenProgram: info.tokenProgram });
  }
  const cfg: FeeConfig = { provider, mode, feeBps, tokens, referralAccount: mode === "referral" ? t.address : undefined, crossChainFeeBps, preferUsdc: input.preferUsdc ?? true };
  cfg.tokens = cfg.tokens.map((tok) => ({ ...tok, tokenAccount: adapter.feeAccount(t, tok, mode) }));
  return cfg;
}

/* ------------------------------------------------------------------ */
/* Change appliers (run only after the required approvals)            */
/* ------------------------------------------------------------------ */

export async function applyChange(c: ChangeRequest, actor: Actor) {
  const p = c.payload as Record<string, unknown>;
  switch (c.action) {
    case "register_treasury": {
      const chain = String(p.chain);
      const c0 = treasuryChain(chain);
      if (!c0) throw new TreasuryError(400, "Unsupported network");
      const adapter = adapterFor(chain);
      const kind = String(p.kind) as TreasuryKind;
      if (!adapter.kinds.includes(kind)) throw new TreasuryError(400, `${kind} is not supported on ${c0.name}`);
      const insp = await adapter.inspect({ chain, environment: String(p.environment ?? "mainnet"), kind, address: String(p.address), vaultIndex: Number(p.vaultIndex ?? 0) });
      if (!insp.ok) throw new TreasuryError(400, insp.errors.join(" "));
      if (insp.receivingAddress !== p.expectedReceivingAddress) throw new TreasuryError(409, "On-chain state changed since the request was signed; please re-submit.");
      await insertTreasury({ chain, chainType: c0.type, environment: String(p.environment ?? "mainnet"), label: String(p.label).slice(0, 60), address: insp.receivingAddress, kind, inspection: insp.facts, createdBy: c.requestedBy });
      return;
    }
    case "update_fees": {
      const t = await getTreasury(String(p.treasuryId));
      if (!t) throw new TreasuryError(404, "Treasury not found");
      const cfg = await buildFeeConfig(t, p.feeConfig as FeeConfigInput);
      // Any fee change requires re-validation and re-activation.
      const status = ["validated", "testing", "active"].includes(t.status) ? "verified" : t.status;
      await updateTreasury(t.id, { feeConfig: cfg, status });
      return;
    }
    case "activate": {
      const t = await getTreasury(String(p.treasuryId));
      if (!t) throw new TreasuryError(404, "Treasury not found");
      if (!t.integrityOk) throw new TreasuryError(409, "Integrity check failed.");
      if (!["validated", "testing"].includes(t.status)) throw new TreasuryError(409, "Treasury must pass validation first.");
      const checks = await latestValidation(t.id);
      const failing = checks.filter((x) => x.required && x.outcome !== "pass");
      if (!checks.length || failing.length) throw new TreasuryError(409, `Validation checks not passing: ${failing.map((f) => f.key).join(", ") || "none run"}`);
      const [test] = await q<{ n: string }>("select count(*)::text as n from revenue_events where treasury_id=$1 and is_test and is_revenue and status='confirmed'", [t.id]);
      if (Number(test?.n ?? 0) < 1) throw new TreasuryError(409, "At least one confirmed test swap fee must reach this treasury before activation.");
      await updateTreasury(t.id, { status: "active" });
      return;
    }
    case "grant_role": {
      const address = String(p.address).startsWith("0x") ? String(p.address).toLowerCase() : String(p.address);
      const role = String(p.role) as Role;
      if (!["viewer", "operator", "admin", "owner"].includes(role)) throw new TreasuryError(400, "Invalid role");
      await q(
        "insert into admins (address, chain_type, role, label, added_by) values ($1,$2,$3,$4,$5) on conflict (address) do update set role=excluded.role, label=excluded.label",
        [address, address.startsWith("0x") ? "evm" : "solana", role, String(p.label ?? "").slice(0, 40) || null, actor.address],
      );
      return;
    }
    case "revoke_role": {
      await q("delete from admins where address=$1", [String(p.address)]);
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fee candidates for live swaps (cached)                              */
/* ------------------------------------------------------------------ */

let candCache: { at: number; byChain: Map<string, FeeCandidate[]> } | null = null;

export async function feeCandidates(chain: string): Promise<FeeCandidate[]> {
  if (!candCache || Date.now() - candCache.at > 15_000) {
    const byChain = new Map<string, FeeCandidate[]>();
    for (const t of await listTreasuries()) {
      if (!t.integrityOk || !t.feeConfig || t.environment !== "mainnet" || !["active", "testing"].includes(t.status)) continue;
      if (t.feeConfig.mode === "cross_chain") continue; // LI.FI fees are selected in the cross-chain route

      const accounts = (t.inspection?.feeAccounts as { token: string; initialized: boolean }[] | undefined) ?? [];
      const cand: FeeCandidate = {
        treasuryId: t.id, status: t.status, mode: t.feeConfig.mode, preferUsdc: t.feeConfig.preferUsdc, bps: t.feeConfig.feeBps, referralAccount: t.feeConfig.referralAccount,
        tokens: t.feeConfig.tokens.map((x) => ({ token: x.token, symbol: x.symbol, decimals: x.decimals, account: x.tokenAccount ?? t.address, initialized: accounts.find((a) => a.token === x.token)?.initialized ?? false })),
      };
      byChain.set(t.chain, [...(byChain.get(t.chain) ?? []), cand]);
    }
    candCache = { at: Date.now(), byChain };
  }
  return candCache.byChain.get(chain) ?? [];
}

export function invalidateCandidates() { candCache = null; }

export async function isAdminAddress(address: string): Promise<boolean> {
  const a = address.startsWith("0x") ? address.toLowerCase() : address;
  if (envOwners().includes(a)) return true;
  const rows = await q("select 1 from admins where address=$1 and role in ('operator','admin','owner')", [a]);
  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface CheckResult { key: string; label: string; outcome: "pass" | "fail" | "warn" | "skip"; detail: string; required: boolean }

export async function latestValidation(treasuryId: string): Promise<CheckResult[]> {
  const rows = await q<{ check_key: string; outcome: string; details: string | null; at: string | Date }>(
    "select distinct on (check_key) check_key, outcome, details, at from validation_runs where treasury_id=$1 order by check_key, at desc", [treasuryId],
  );
  return rows.map((r) => ({ ...(JSON.parse(r.details ?? "{}") as Omit<CheckResult, "key" | "outcome">), key: r.check_key, outcome: r.outcome as CheckResult["outcome"] }));
}

export async function runValidation(t: Treasury, actor: Actor, liveQuoteCheck: (t: Treasury) => Promise<{ ok: boolean; detail: string }>): Promise<CheckResult[]> {
  const adapter = adapterFor(t.chain);
  const results: CheckResult[] = [];
  const add = (key: string, label: string, outcome: CheckResult["outcome"], detail: string, required = true) => results.push({ key, label, outcome, detail, required });

  add("integrity", "Record integrity seal", t.integrityOk ? "pass" : "fail", t.integrityOk ? "HMAC seal matches stored address and fee configuration." : "Seal mismatch — record may have been modified outside the app.");
  add("ownership", "Address ownership verified", t.ownership ? "pass" : "fail", t.ownership ? `${t.ownership.method}: ${t.ownership.detail}` : "Sign the ownership message with the treasury wallet / a multisig member.");
  try {
    const insp = await adapter.inspect({ chain: t.chain, environment: t.environment, kind: t.kind, address: t.kind === "squads" ? String(t.inspection?.multisig) : t.address, vaultIndex: Number(t.inspection?.vaultIndex ?? 0) });
    const same = insp.receivingAddress === t.address;
    add("onchain", "On-chain account check", insp.ok && same ? (insp.warnings.length ? "warn" : "pass") : "fail", [...insp.errors, ...insp.warnings, same ? "" : "Receiving address changed on-chain."].filter(Boolean).join(" ") || "Account matches the registered configuration.");
  } catch (e) {
    add("onchain", "On-chain account check", "fail", `RPC error: ${String(e)}`);
  }
  add("fee_config", "Fee configuration", t.feeConfig?.tokens.length ? "pass" : "fail", t.feeConfig ? `${t.feeConfig.provider} ${t.feeConfig.mode} · ${t.feeConfig.feeBps} bps · ${t.feeConfig.tokens.map((x) => x.symbol).join(", ")}` : "Configure fee tokens and rate.");
  let accounts: { token: string; account: string; initialized: boolean; detail?: string }[] = [];
  if (t.feeConfig) {
    try {
      accounts = await adapter.checkFeeAccounts(t);
      const missing = accounts.filter((a) => !a.initialized);
      add("fee_accounts", t.chainType === "solana" ? "Fee token accounts initialized" : "Fee recipient ready", missing.length ? "fail" : "pass", missing.length ? `Missing: ${missing.map((m) => `${m.token.slice(0, 6)}… (${m.detail})`).join(", ")}` : `${accounts.length} account(s) ready.`);
      await updateTreasury(t.id, { inspection: { ...(t.inspection ?? {}), feeAccounts: accounts, feeAccountsCheckedAt: new Date().toISOString() } });
    } catch (e) {
      add("fee_accounts", "Fee accounts", "fail", String(e));
    }
  }
  if (t.feeConfig && accounts.every((a) => a.initialized)) {
    try {
      const r = await liveQuoteCheck(t);
      add("live_quote", "Live quote includes the platform fee", r.ok ? "pass" : "fail", r.detail);
    } catch (e) {
      add("live_quote", "Live quote includes the platform fee", "fail", String(e));
    }
  } else add("live_quote", "Live quote includes the platform fee", "skip", "Runs once fee accounts are ready.");
  if (t.chainType === "bitcoin") {
    const ok = !!process.env.LIFI_INTEGRATOR;
    add("api_key", "LI.FI integrator", ok ? "pass" : "fail", ok ? `Integrator "${process.env.LIFI_INTEGRATOR}" configured. Its fee wallet for Bitcoin in the LI.FI Partner Portal must be exactly ${t.address}.` : "LIFI_INTEGRATOR is required: cross-chain fees are only paid to integrators registered at portal.li.fi.");
  }
  const keyOk = t.chainType === "bitcoin" ? true : t.chainType === "solana" ? !!process.env.JUPITER_API_KEY : !!process.env.ZEROX_API_KEY;
  if (t.chainType !== "bitcoin")
  add("api_key", t.chainType === "solana" ? "Jupiter API key" : "0x API key", keyOk ? "pass" : t.chainType === "solana" ? "warn" : "fail", keyOk ? "Configured (server-side environment variable)." : t.chainType === "solana" ? "JUPITER_API_KEY not set — keyless access is limited to 0.5 req/s." : "ZEROX_API_KEY is required for EVM swaps.", t.chainType !== "solana");
  if (t.environment !== "mainnet") add("environment", "Network environment", "warn", "Testnet treasury: fee collection only runs on mainnet; this record is for indexer testing.", false);

  for (const r of results) await q("insert into validation_runs (treasury_id, check_key, outcome, details) values ($1,$2,$3,$4)", [t.id, r.key, r.outcome, JSON.stringify({ label: r.label, detail: r.detail, required: r.required })]);
  const passed = results.filter((r) => r.required).every((r) => r.outcome === "pass" || r.outcome === "warn");
  if (passed && t.status === "verified") await updateTreasury(t.id, { status: "validated" });
  invalidateCandidates();
  await audit({ actor: actor.address, role: actor.role, action: "treasury.validate", target: t.id, outcome: "ok", details: { passed, results: results.map((r) => `${r.key}:${r.outcome}`) } });
  return results;
}

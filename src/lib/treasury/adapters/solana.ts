import "server-only";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { verifySolana } from "../../server/auth";
import { getTokensInfo } from "../../trading/jupiter";
import { KNOWN_TOKENS, knownToken, WSOL } from "../tokens";
import {
  ata, createAtaIdempotentIx, getAccount, isSolanaAddress, JUPITER_REFERRAL_PROJECT, mintInfo, parseReferralAccount, parseSquadsMultisig,
  REFERRAL_PROGRAM, squadsVault, SQUADS_V4_PROGRAM, srpc, TOKEN_PROGRAM, tokenHoldings,
} from "../solana";
import type { FeeToken, Treasury } from "../store";
import type { Balance, Inspection, TreasuryAdapter } from "./types";

const SYSTEM = "11111111111111111111111111111111";

function accountData(acc: { data: unknown }): Buffer {
  const d = acc.data as [string, string];
  return Buffer.from(d[0], "base64");
}

/** Fee token accounts are owned by the wallet/vault (platform fees) or by the referral account (referral fees). */
function feeOwner(t: Treasury, mode: string): string {
  if (mode === "referral") return t.feeConfig?.referralAccount ?? t.address;
  return t.address;
}

export const solanaAdapter: TreasuryAdapter = {
  chainType: "solana",
  kinds: ["wallet", "squads", "jupiter_referral"],
  validAddress: isSolanaAddress,

  async inspect({ environment, kind, address, vaultIndex = 0 }): Promise<Inspection> {
    const warnings: string[] = [], errors: string[] = [];
    if (!isSolanaAddress(address)) return { ok: false, receivingAddress: address, facts: {}, warnings, errors: ["Not a valid Solana address."] };
    if (kind === "wallet") {
      const acc = await getAccount(address, environment, "base64");
      const facts: Record<string, unknown> = { exists: !!acc, owner: acc?.owner ?? null, lamports: acc?.lamports ?? 0 };
      if (!acc) warnings.push("Account has no SOL yet (it will be created when it first receives funds).");
      else if (acc.owner !== SYSTEM) errors.push(`Address is owned by program ${acc.owner}, not a regular wallet. Use the Squads option for multisig vaults.`);
      if (!PublicKey.isOnCurve(new PublicKey(address).toBytes())) errors.push("Address is a program-derived address, not a wallet key.");
      return { ok: errors.length === 0, receivingAddress: address, facts, warnings, errors };
    }
    if (kind === "squads") {
      const acc = await getAccount(address, environment, "base64");
      if (!acc) return { ok: false, receivingAddress: address, facts: {}, warnings, errors: ["Multisig account not found. Enter the Squads multisig (not vault) address."] };
      if (acc.owner !== SQUADS_V4_PROGRAM) return { ok: false, receivingAddress: address, facts: { owner: acc.owner }, warnings, errors: ["Account is not a Squads v4 multisig."] };
      try {
        const { threshold, members } = parseSquadsMultisig(accountData(acc));
        const vault = squadsVault(address, vaultIndex);
        if (threshold < 2) warnings.push("Multisig threshold is 1 — a single member can move funds.");
        return { ok: true, receivingAddress: vault, facts: { multisig: address, vaultIndex, vault, threshold, members }, warnings, errors };
      } catch (e) {
        return { ok: false, receivingAddress: address, facts: {}, warnings, errors: [`Could not read multisig: ${String(e)}`] };
      }
    }
    // jupiter_referral
    const acc = await getAccount(address, environment, "base64");
    if (!acc) return { ok: false, receivingAddress: address, facts: {}, warnings, errors: ["Referral account not found. Create it on referral.jup.ag first."] };
    if (acc.owner !== REFERRAL_PROGRAM) return { ok: false, receivingAddress: address, facts: { owner: acc.owner }, warnings, errors: ["Account is not owned by the Jupiter Referral Program."] };
    const { partner, project } = parseReferralAccount(accountData(acc));
    if (project !== JUPITER_REFERRAL_PROJECT) errors.push(`Referral account belongs to project ${project}, not Jupiter's Swap referral project.`);
    return { ok: errors.length === 0, receivingAddress: address, facts: { partner, project }, warnings, errors };
  },

  async verifyOwnership(t, signer, message, signature) {
    if (!verifySolana(message, signature, signer)) return { ok: false, method: "ed25519", detail: "Signature does not verify." };
    if (!message.includes(t.address)) return { ok: false, method: "ed25519", detail: "Message does not reference this treasury." };
    const insp = await this.inspect({ chain: t.chain, environment: t.environment, kind: t.kind, address: t.kind === "squads" ? String(t.inspection?.multisig) : t.address, vaultIndex: Number(t.inspection?.vaultIndex ?? 0) });
    if (t.kind === "wallet") return signer === t.address ? { ok: true, method: "wallet-signature", detail: "Signed by the treasury wallet itself." } : { ok: false, method: "wallet-signature", detail: "Signer is not the treasury address." };
    if (t.kind === "squads") {
      const members = (insp.facts.members as string[]) ?? [];
      if (insp.receivingAddress !== t.address) return { ok: false, method: "squads-member", detail: "Vault no longer matches the multisig." };
      return members.includes(signer)
        ? { ok: true, method: "squads-member", detail: `Signed by multisig member; threshold ${insp.facts.threshold}/${members.length}.` }
        : { ok: false, method: "squads-member", detail: "Signer is not a member of this multisig." };
    }
    return insp.facts.partner === signer
      ? { ok: true, method: "referral-partner", detail: "Signed by the referral account's partner (admin) wallet." }
      : { ok: false, method: "referral-partner", detail: `Signer is not the referral partner (${insp.facts.partner}).` };
  },

  async tokenInfo(_chain, token, environment) {
    const m = await mintInfo(token, environment);
    if (!m) return null;
    const known = knownToken("solana", token);
    let symbol = known?.symbol;
    if (!symbol) {
      try { symbol = (await getTokensInfo([token])).data.find((x) => x.address === token)?.symbol; } catch { /* optional */ }
    }
    return { symbol: symbol ?? token.slice(0, 4), decimals: m.decimals, tokenProgram: m.tokenProgram };
  },

  feeAccount(t, token: FeeToken, mode) {
    return ata(feeOwner(t, mode), token.token, token.tokenProgram ?? TOKEN_PROGRAM);
  },

  async checkFeeAccounts(t) {
    const cfg = t.feeConfig;
    if (!cfg) return [];
    const out = [];
    for (const tok of cfg.tokens) {
      const account = this.feeAccount(t, tok, cfg.mode);
      const acc = await getAccount(account, t.environment);
      const info = (acc?.data as { parsed?: { info?: { mint: string; owner: string } } } | undefined)?.parsed?.info;
      const owner = feeOwner(t, cfg.mode);
      const initialized = !!acc && info?.mint === tok.token && info?.owner === owner;
      out.push({ token: tok.token, account, initialized, detail: !acc ? "not created" : initialized ? undefined : "account exists but mint/owner mismatch" });
    }
    return out;
  },

  async balances(t) {
    const owner = t.address;
    const out: Balance[] = [];
    if (t.kind !== "jupiter_referral") {
      const sol = await srpc<{ value: number }>("getBalance", [owner, { commitment: "confirmed" }], t.environment);
      out.push({ token: WSOL, symbol: "SOL", decimals: 9, amountRaw: String(sol.value), account: owner, native: true });
    }
    for (const h of await tokenHoldings(owner, t.environment, [...KNOWN_TOKENS.solana.map((k) => k.token), ...(t.feeConfig?.tokens.map((x) => x.token) ?? [])])) {
      if (h.amountRaw === "0" && !t.feeConfig?.tokens.some((x) => x.token === h.mint)) continue;
      const known = knownToken("solana", h.mint) ?? t.feeConfig?.tokens.find((x) => x.token === h.mint);
      out.push({ token: h.mint, symbol: known?.symbol ?? h.mint.slice(0, 4), decimals: h.decimals, amountRaw: h.amountRaw, account: h.account });
    }
    return out;
  },
};

/**
 * Unsigned transaction that creates missing fee/referral token accounts
 * (createAssociatedTokenAccountIdempotent). Paid and signed by the connected
 * admin wallet; the treasury/referral account is only the owner.
 */
export async function buildInitTokenAccountsTx(t: Treasury, payer: string): Promise<{ transaction: string; created: string[]; simulation: { err: unknown; logs: string[] | null } }> {
  const cfg = t.feeConfig;
  if (!cfg) throw new Error("Configure fee tokens first.");
  const status = await solanaAdapter.checkFeeAccounts(t);
  const missing = cfg.tokens.filter((tok) => !status.find((s) => s.token === tok.token)?.initialized);
  if (!missing.length) throw new Error("All fee token accounts are already initialized.");
  const owner = cfg.mode === "referral" ? cfg.referralAccount! : t.address;
  const ixs = missing.map((tok) => createAtaIdempotentIx(payer, owner, tok.token, tok.tokenProgram ?? TOKEN_PROGRAM));
  const { value } = await srpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }], t.environment);
  const msg = new TransactionMessage({ payerKey: new PublicKey(payer), recentBlockhash: value.blockhash, instructions: ixs }).compileToV0Message();
  const tx = Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
  const sim = await srpc<{ value: { err: unknown; logs: string[] | null } }>("simulateTransaction", [tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }], t.environment);
  return { transaction: tx, created: missing.map((m) => solanaAdapter.feeAccount(t, m, cfg.mode)), simulation: sim.value };
}

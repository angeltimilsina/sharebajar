import "server-only";
import { q, newId } from "./db";
import { decrypt, encrypt, seal, verifySeal } from "./crypto";
import { alert } from "./audit";

export type TreasuryKind = "wallet" | "safe" | "squads" | "jupiter_referral";
export type TreasuryStatus = "registered" | "verified" | "validated" | "testing" | "active" | "disabled";
export type FeeMode = "platform" | "referral" | "integrator" | "cross_chain";

export interface FeeToken {
  token: string;          // mint / contract
  symbol: string;
  decimals: number;
  tokenProgram?: string;  // Solana
  tokenAccount?: string;  // Solana fee / referral token account
  initialized?: boolean;
}

export interface FeeConfig {
  provider: "jupiter" | "0x" | "lifi";
  /** jupiter: "platform" (/build platformFeeBps) or "referral" (/order referralFee). 0x: "integrator". */
  mode: FeeMode;
  feeBps: number;
  /** Jupiter referral account (mode = referral). */
  referralAccount?: string;
  tokens: FeeToken[];
  /** LI.FI cross-chain fee for routes whose SOURCE chain is this treasury's chain. Replaces the standard swap fee. */
  crossChainFeeBps?: number;
  /** Prefer USDC as the fee token where the provider lets us choose (0x). */
  preferUsdc?: boolean;
}

export interface Ownership { method: string; signer: string; message: string; signature: string; verifiedAt: string; detail: string }

export interface Treasury {
  id: string;
  chain: string;
  chainType: "solana" | "evm" | "bitcoin";
  environment: "mainnet" | "testnet";
  label: string;
  address: string;
  kind: TreasuryKind;
  status: TreasuryStatus;
  ownership: Ownership | null;
  inspection: Record<string, unknown> | null;
  feeConfig: FeeConfig | null;
  integrityOk: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string; chain: string; chain_type: string; environment: string; label: string; address: string; kind: string; status: string;
  ownership: string | null; inspection: string | null; fee_config: string | null; integrity: string; created_by: string; created_at: string | Date; updated_at: string | Date;
}

/** Fields covered by the integrity seal (everything that affects where money goes). */
const sealFields = (r: Pick<Row, "id" | "chain" | "environment" | "address" | "kind" | "status" | "fee_config" | "ownership">) => ({
  id: r.id, chain: r.chain, environment: r.environment, address: r.address, kind: r.kind, status: r.status, fee_config: r.fee_config, ownership: r.ownership,
});

const alerted = new Set<string>();

function hydrate(r: Row): Treasury {
  const ok = verifySeal(sealFields(r), r.integrity);
  if (!ok && !alerted.has(r.id)) {
    alerted.add(r.id);
    void alert("critical", "integrity_failure", `Treasury record ${r.id} (${r.chain} ${r.address}) failed its integrity check — fee collection disabled for it until resolved.`);
  }
  let feeConfig: FeeConfig | null = null;
  try { feeConfig = decrypt<FeeConfig>(r.fee_config); } catch { /* undecryptable ⇒ treated as tampered */ }
  return {
    id: r.id, chain: r.chain, chainType: r.chain_type as Treasury["chainType"], environment: r.environment as Treasury["environment"],
    label: r.label, address: r.address, kind: r.kind as TreasuryKind, status: r.status as TreasuryStatus,
    ownership: r.ownership ? JSON.parse(r.ownership) : null, inspection: r.inspection ? JSON.parse(r.inspection) : null,
    feeConfig, integrityOk: ok && (r.fee_config === null || feeConfig !== null),
    createdBy: r.created_by, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function listTreasuries(): Promise<Treasury[]> {
  return (await q<Row>("select * from treasuries order by created_at")).map(hydrate);
}

export async function getTreasury(id: string): Promise<Treasury | null> {
  const [r] = await q<Row>("select * from treasuries where id = $1", [id]);
  return r ? hydrate(r) : null;
}

export async function insertTreasury(t: { chain: string; chainType: string; environment: string; label: string; address: string; kind: TreasuryKind; inspection: unknown; createdBy: string }): Promise<Treasury> {
  const id = newId("trs");
  const row = { id, chain: t.chain, environment: t.environment, address: t.address, kind: t.kind, status: "registered", fee_config: null, ownership: null };
  await q(
    `insert into treasuries (id, chain, chain_type, environment, label, address, kind, status, inspection, integrity, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,'registered',$8,$9,$10)`,
    [id, t.chain, t.chainType, t.environment, t.label, t.address, t.kind, JSON.stringify(t.inspection ?? null), seal(row), t.createdBy],
  );
  return (await getTreasury(id))!;
}

/** Update sealed fields; refuses to modify a record whose integrity is broken. */
export async function updateTreasury(id: string, patch: { status?: TreasuryStatus; feeConfig?: FeeConfig | null; ownership?: Ownership | null; inspection?: unknown; label?: string }): Promise<Treasury> {
  const [r] = await q<Row>("select * from treasuries where id = $1", [id]);
  if (!r) throw new Error("Treasury not found");
  if (!verifySeal(sealFields(r), r.integrity)) throw new Error("Treasury record failed its integrity check; refusing to modify it.");
  const next: Row = {
    ...r,
    status: patch.status ?? r.status,
    fee_config: patch.feeConfig === undefined ? r.fee_config : patch.feeConfig === null ? null : encrypt(patch.feeConfig),
    ownership: patch.ownership === undefined ? r.ownership : patch.ownership === null ? null : JSON.stringify(patch.ownership),
    inspection: patch.inspection === undefined ? r.inspection : JSON.stringify(patch.inspection),
    label: patch.label ?? r.label,
  };
  await q(
    "update treasuries set status=$2, fee_config=$3, ownership=$4, inspection=$5, label=$6, integrity=$7, updated_at=now() where id=$1",
    [id, next.status, next.fee_config, next.ownership, next.inspection, next.label, seal(sealFields(next))],
  );
  return (await getTreasury(id))!;
}

/** Treasuries allowed to receive fees right now (active, or testing for admin test swaps). */
export async function feeTreasuries(chain: string): Promise<Treasury[]> {
  return (await listTreasuries()).filter((t) => t.chain === chain && t.integrityOk && t.feeConfig && (t.status === "active" || t.status === "testing") && t.environment === "mainnet");
}

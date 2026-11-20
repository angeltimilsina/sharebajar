import type { FeeToken, Treasury, TreasuryKind } from "../store";

export interface Inspection {
  ok: boolean;
  /** The receiving address funds actually land in (e.g. Squads vault PDA). */
  receivingAddress: string;
  facts: Record<string, unknown>;
  warnings: string[];
  errors: string[];
}

export interface OwnershipResult { ok: boolean; method: string; detail: string }

export interface Balance { token: string; symbol: string; decimals: number; amountRaw: string; account: string; native?: boolean }

/** Extensible treasury adapter — add a network by implementing this. */
export interface TreasuryAdapter {
  chainType: "solana" | "evm" | "bitcoin";
  kinds: TreasuryKind[];
  validAddress(address: string): boolean;
  inspect(input: { chain: string; environment: string; kind: TreasuryKind; address: string; vaultIndex?: number }): Promise<Inspection>;
  verifyOwnership(t: Treasury, signer: string, message: string, signature: string): Promise<OwnershipResult>;
  tokenInfo(chain: string, token: string, environment: string): Promise<{ symbol: string; decimals: number; tokenProgram?: string } | null>;
  /** Where fees in `token` are received (Solana token account; EVM = the address). */
  feeAccount(t: Treasury, token: FeeToken, mode: string): string;
  checkFeeAccounts(t: Treasury): Promise<{ token: string; account: string; initialized: boolean; detail?: string }[]>;
  balances(t: Treasury): Promise<Balance[]>;
}

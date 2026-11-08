import "server-only";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { fetchUpstream } from "../server/http";

/** Server-side Solana helpers (read-only RPC; nothing here can sign). */
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const REFERRAL_PROGRAM = "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";
/** DFlow aggregator — Jupiter's meta-aggregator also routes /order swaps through it. */
export const DFLOW_PROGRAM = "DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH";
export const SWAP_PROGRAMS = new Set(["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", REFERRAL_PROGRAM, DFLOW_PROGRAM]);
/** Jupiter's referral project used by Swap API V2 /order (per Jupiter docs). */
export const JUPITER_REFERRAL_PROJECT = "DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc";
export const SQUADS_V4_PROGRAM = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
/** Jupiter keeps this share of referral fees on /order (per Jupiter docs). */
export const JUPITER_REFERRAL_SHARE_BPS = 2000;

export function solanaRpcUrl(environment: string = "mainnet") {
  if (environment === "testnet") return process.env.SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com";
  return process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
}

let rid = 1;
export async function srpc<T>(method: string, params: unknown[], environment = "mainnet"): Promise<T> {
  const r = await fetchUpstream<{ result?: T; error?: { message: string } }>(solanaRpcUrl(environment), {
    method: "POST", body: { jsonrpc: "2.0", id: rid++, method, params }, timeoutMs: 15_000, retries: 1,
  });
  if (r.error) throw new Error(`Solana RPC ${method}: ${r.error.message}`);
  return r.result as T;
}

export const isSolanaAddress = (a: string) => {
  try { return new PublicKey(a).toBase58() === a; } catch { return false; }
};

export function ata(owner: string, mint: string, tokenProgram = TOKEN_PROGRAM): string {
  const [addr] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(ATA_PROGRAM),
  );
  return addr.toBase58();
}

/** createAssociatedTokenAccountIdempotent — safe to include even if it exists. */
export function createAtaIdempotentIx(payer: string, owner: string, mint: string, tokenProgram = TOKEN_PROGRAM): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ATA_PROGRAM),
    keys: [
      { pubkey: new PublicKey(payer), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(ata(owner, mint, tokenProgram)), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(owner), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(tokenProgram), isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export interface ParsedAccount { owner: string; lamports: number; data: unknown; executable: boolean }

export async function getAccount(address: string, environment = "mainnet", encoding: "jsonParsed" | "base64" = "jsonParsed"): Promise<ParsedAccount | null> {
  const r = await srpc<{ value: ParsedAccount | null }>("getAccountInfo", [address, { encoding, commitment: "confirmed" }], environment);
  return r.value;
}

export async function mintInfo(mint: string, environment = "mainnet"): Promise<{ decimals: number; tokenProgram: string } | null> {
  const acc = await getAccount(mint, environment);
  if (!acc || ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(acc.owner)) return null;
  const parsed = (acc.data as { parsed?: { type: string; info: { decimals: number } } }).parsed;
  if (parsed?.type !== "mint") return null;
  return { decimals: parsed.info.decimals, tokenProgram: acc.owner };
}

/** Squads v4 vault PDA for a multisig. */
export function squadsVault(multisig: string, index = 0): string {
  const [v] = PublicKey.findProgramAddressSync(
    [Buffer.from("multisig"), new PublicKey(multisig).toBuffer(), Buffer.from("vault"), Buffer.from([index])],
    new PublicKey(SQUADS_V4_PROGRAM),
  );
  return v.toBase58();
}

/**
 * Parse a Squads v4 Multisig account: threshold and members.
 * Layout: disc(8) create_key(32) config_authority(32) threshold(u16) time_lock(u32)
 * transaction_index(u64) stale_transaction_index(u64) rent_collector(Option<Pubkey>)
 * bump(u8) members(Vec<{key:Pubkey, permissions:u8}>)
 */
export function parseSquadsMultisig(data: Buffer): { threshold: number; members: string[] } {
  let o = 8 + 32 + 32;
  const threshold = data.readUInt16LE(o); o += 2;
  o += 4 + 8 + 8;
  const hasRent = data.readUInt8(o); o += 1;
  if (hasRent === 1) o += 32;
  o += 1; // bump
  const n = data.readUInt32LE(o); o += 4;
  if (n > 64) throw new Error("Unexpected Squads member count");
  const members: string[] = [];
  for (let i = 0; i < n; i++) { members.push(new PublicKey(data.subarray(o, o + 32)).toBase58()); o += 33; }
  return { threshold, members };
}

/** Parse a Jupiter Referral Program `ReferralAccount`: partner + project. */
export function parseReferralAccount(data: Buffer): { partner: string; project: string } {
  return { partner: new PublicKey(data.subarray(8, 40)).toBase58(), project: new PublicKey(data.subarray(40, 72)).toBase58() };
}

export interface TokenHolding { account: string; mint: string; amountRaw: string; decimals: number; tokenProgram: string }

/**
 * Token balances of `owner`. Uses getTokenAccountsByOwner when the RPC allows it;
 * many public RPCs block that method, so we fall back to reading the owner's
 * associated token accounts for `candidateMints` with getMultipleAccounts.
 */
export async function tokenHoldings(owner: string, environment = "mainnet", candidateMints: string[] = []): Promise<TokenHolding[]> {
  try {
    return await tokenHoldingsByOwner(owner, environment);
  } catch {
    const mints = [...new Set(candidateMints)];
    const keys = mints.flatMap((m) => [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((p) => ({ mint: m, program: p, account: ata(owner, m, p) })));
    const out: TokenHolding[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      const r = await srpc<{ value: ({ owner: string; data: { parsed?: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } | null)[] }>(
        "getMultipleAccounts", [chunk.map((k) => k.account), { encoding: "jsonParsed", commitment: "confirmed" }], environment,
      );
      r.value.forEach((acc, j) => {
        const info = acc?.data?.parsed?.info;
        if (info) out.push({ account: chunk[j].account, mint: info.mint, amountRaw: info.tokenAmount.amount, decimals: info.tokenAmount.decimals, tokenProgram: chunk[j].program });
      });
    }
    return out;
  }
}

async function tokenHoldingsByOwner(owner: string, environment: string): Promise<TokenHolding[]> {
  const out: TokenHolding[] = [];
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const r = await srpc<{ value: { pubkey: string; account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } }[] }>(
      "getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }], environment,
    );
    for (const a of r.value) {
      const i = a.account.data.parsed.info;
      out.push({ account: a.pubkey, mint: i.mint, amountRaw: i.tokenAmount.amount, decimals: i.tokenAmount.decimals, tokenProgram: programId });
    }
  }
  return out;
}

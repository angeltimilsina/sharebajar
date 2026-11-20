"use client";
import { Buffer } from "buffer";
import type { Transaction, TransactionInstruction as TI } from "@solana/web3.js";
import { ATA_PROGRAM, METADATA_PROGRAM, TOKEN_PROGRAM, SIM_COMPUTE_UNITS, PRIORITY_MICROLAMPORTS, computeLimitFrom, confirmSignature, explainSimulation, sendSigned, simulate, solRpc } from "./solanaToken";

/**
 * After-launch controls for an SPL token, built in the browser and signed by
 * the creator's wallet. Each control only works while the wallet still holds
 * the matching authority; revoking is permanent.
 */
export interface SolanaTokenState {
  mint: string;
  decimals: number;
  supplyRaw: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  metadata: ParsedMetadata | null;
  balanceRaw: bigint;
  tokenProgram: string;
}

const rpc = solRpc;

export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const utf8 = (s: string) => Buffer.from(s, "utf8");
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n, 0); return b; };
const borshString = (s: string) => Buffer.concat([u32(utf8(s).length), utf8(s)]);

export interface ParsedMetadata {
  updateAuthority: string; mint: string; isMutable: boolean; name: string; symbol: string; uri: string;
  sellerFeeBasisPoints: number;
  /** Borsh bytes of Option<Vec<Creator>>, Option<Collection>, Option<Uses> — re-sent unchanged on edit so royalties/creators/collection survive. */
  raw: { creators: Buffer; collection: Buffer; uses: Buffer };
}

/**
 * Parse a Metaplex metadata account: key(4 = MetadataV1), update authority, mint, Data{name, symbol, uri,
 * seller fee, creators}, primary_sale, is_mutable, edition_nonce, token_standard, collection, uses.
 * Returns null for anything that isn't a well-formed metadata account (never throws).
 */
export function parseMetadata(b: Buffer, toB58: (x: Buffer) => string): ParsedMetadata | null {
  try {
    if (b.length < 1 + 64 + 12 || b[0] !== 4) return null;
    let o = 1;
    const need = (n: number) => { if (o + n > b.length) throw new RangeError("short"); };
    const updateAuthority = toB58(b.subarray(o, o + 32)); o += 32;
    const mint = toB58(b.subarray(o, o + 32)); o += 32;
    const str = (max: number) => { need(4); const n = b.readUInt32LE(o); o += 4; if (n > max) throw new RangeError("len"); need(n); const s = b.subarray(o, o + n).toString("utf8").replace(/\0+$/, ""); o += n; return s; };
    const name = str(64), symbol = str(32), uri = str(400);
    need(3);
    const sellerFeeBasisPoints = b.readUInt16LE(o); o += 2;
    const c0 = o;
    if (b[o++] === 1) { need(4); const n = b.readUInt32LE(o); if (n > 5) throw new RangeError("creators"); o += 4 + n * 34; need(0); }
    const creators = Buffer.from(b.subarray(c0, o));
    need(2);
    o += 1; // primary_sale_happened
    const isMutable = b[o++] === 1;
    // Trailing optional fields; older accounts are zero-padded (= None) or end early.
    const opt = (size: number) => { if (o >= b.length || b[o] !== 1) { o += 1; return Buffer.from([0]); } const s = Buffer.from(b.subarray(o, o + 1 + size)); o += 1 + size; return s.length === 1 + size ? s : Buffer.from([0]); };
    opt(1); // edition_nonce
    opt(1); // token_standard
    const collection = opt(33);
    const uses = opt(17);
    return { updateAuthority, mint, isMutable, name, symbol, uri, sellerFeeBasisPoints, raw: { creators, collection, uses } };
  } catch {
    return null;
  }
}

export async function readSolanaToken(mint: string, owner: string): Promise<SolanaTokenState> {
  const { PublicKey } = await import("@solana/web3.js");
  const acc = await rpc<{ value: { owner: string; data: { parsed?: { type: string; info: { decimals: number; supply: string; mintAuthority: string | null; freezeAuthority: string | null } } } } | null }>("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
  const info = acc.value?.data?.parsed?.type === "mint" ? acc.value.data.parsed.info : null;
  if (!info || !acc.value) throw new Error("Mint account not found.");
  const mdProg = new PublicKey(METADATA_PROGRAM);
  const [pda] = PublicKey.findProgramAddressSync([utf8("metadata"), mdProg.toBuffer(), new PublicKey(mint).toBuffer()], mdProg);
  const tokenProgram = acc.value.owner;
  if (tokenProgram !== TOKEN_PROGRAM && tokenProgram !== TOKEN_2022) throw new Error("This isn't an SPL Token or Token-2022 mint.");
  // The associated token account is derived with the mint's own program (Token-2022 mints have different ATAs).
  const ata = PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA_PROGRAM))[0];
  const [md, bal] = await Promise.all([
    rpc<{ value: { owner: string; data: [string, string] } | null }>("getAccountInfo", [pda.toBase58(), { encoding: "base64", commitment: "confirmed" }]),
    rpc<{ value: { data: { parsed?: { info: { tokenAmount: { amount: string } } } } } | null }>("getAccountInfo", [ata.toBase58(), { encoding: "jsonParsed", commitment: "confirmed" }]),
  ]);
  const parsed = md.value && md.value.owner === METADATA_PROGRAM ? parseMetadata(Buffer.from(md.value.data[0], "base64"), (x) => new PublicKey(x).toBase58()) : null;
  const metadata = parsed && parsed.mint === mint ? parsed : null;
  return {
    mint, decimals: info.decimals, supplyRaw: BigInt(info.supply), mintAuthority: info.mintAuthority, freezeAuthority: info.freezeAuthority,
    metadata, balanceRaw: BigInt(bal.value?.data?.parsed?.info?.tokenAmount?.amount ?? "0"), tokenProgram,
  };
}

export type ManageAction =
  | { kind: "revokeMint" }
  | { kind: "revokeFreeze" }
  | { kind: "burn"; amountRaw: bigint }
  | { kind: "mint"; amountRaw: bigint }
  | { kind: "updateMetadata"; name: string; symbol: string; uri: string }
  | { kind: "lockMetadata" };

export function describe(a: ManageAction, symbol: string, decimals: number): string {
  const fmt = (r: bigint) => {
    // Exact for any u64 amount (Number() loses precision above 2^53).
    const d = BigInt(10) ** BigInt(decimals), whole = r / d, frac = (r % d).toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
  };
  switch (a.kind) {
    case "revokeMint": return `Permanently revoke the mint authority of ${symbol}. Nobody, including you, can ever create more.`;
    case "revokeFreeze": return `Permanently revoke the freeze authority of ${symbol}. Nobody can freeze holders' tokens.`;
    case "burn": return `Burn ${fmt(a.amountRaw)} ${symbol} from your wallet. This lowers the total supply and can't be undone.`;
    case "mint": return `Mint ${fmt(a.amountRaw)} new ${symbol} to your wallet. This increases the total supply.`;
    case "updateMetadata": return `Change ${symbol}'s on-chain name to "${a.name}", symbol to "${a.symbol}" and metadata link.`;
    case "lockMetadata": return `Permanently lock ${symbol}'s metadata. Name, symbol and image can never change again.`;
  }
}

export async function buildManageTransaction(s: SolanaTokenState, owner: string, a: ManageAction, blockhash: string, computeUnits = SIM_COMPUTE_UNITS): Promise<Transaction> {
  const { PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram, SystemProgram } = await import("@solana/web3.js");
  const me = new PublicKey(owner), mint = new PublicKey(s.mint), prog = new PublicKey(s.tokenProgram);
  if (s.tokenProgram !== TOKEN_PROGRAM && s.tokenProgram !== TOKEN_2022) throw new Error("Unsupported token program.");
  const ata = PublicKey.findProgramAddressSync([me.toBuffer(), prog.toBuffer(), mint.toBuffer()], new PublicKey(ATA_PROGRAM))[0];
  const ix: TI[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS })];
  const mdProg = new PublicKey(METADATA_PROGRAM);
  const [metadata] = PublicKey.findProgramAddressSync([utf8("metadata"), mdProg.toBuffer(), mint.toBuffer()], mdProg);
  const need = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

  switch (a.kind) {
    case "revokeMint":
    case "revokeFreeze": {
      const type = a.kind === "revokeMint" ? 0 : 1;
      need((a.kind === "revokeMint" ? s.mintAuthority : s.freezeAuthority) === owner, "This wallet doesn't hold that authority.");
      ix.push(new TransactionInstruction({ programId: prog, keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false }], data: Buffer.from([6, type, 0]) }));
      break;
    }
    case "burn":
      need(a.amountRaw > BigInt(0) && a.amountRaw <= s.balanceRaw, "Amount is more than your balance.");
      // BurnChecked (15)
      ix.push(new TransactionInstruction({ programId: prog, keys: [{ pubkey: ata, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false }], data: Buffer.concat([Buffer.from([15]), u64(a.amountRaw), Buffer.from([s.decimals])]) }));
      break;
    case "mint":
      need(s.mintAuthority === owner, "This wallet doesn't hold the mint authority.");
      need(a.amountRaw > BigInt(0) && s.supplyRaw + a.amountRaw <= BigInt("18446744073709551615"), "Amount is too large.");
      // Your token account may have been closed (or never existed for an imported mint): create it idempotently first.
      ix.push(new TransactionInstruction({
        programId: new PublicKey(ATA_PROGRAM), data: Buffer.from([1]), // CreateIdempotent
        keys: [
          { pubkey: me, isSigner: true, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: me, isSigner: false, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: prog, isSigner: false, isWritable: false },
        ],
      }));
      // MintToChecked (14) to your own token account
      ix.push(new TransactionInstruction({ programId: prog, keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false }], data: Buffer.concat([Buffer.from([14]), u64(a.amountRaw), Buffer.from([s.decimals])]) }));
      break;
    case "updateMetadata":
    case "lockMetadata": {
      need(!!s.metadata && s.metadata.isMutable && s.metadata.updateAuthority === owner, "Metadata is locked or owned by another wallet.");
      const m = s.metadata!;
      const fee = Buffer.alloc(2); fee.writeUInt16LE(m.sellerFeeBasisPoints, 0);
      // DataV2 replaces the whole record: keep the existing royalty, creators, collection and uses.
      const data = a.kind === "updateMetadata"
        ? Buffer.concat([Buffer.from([1]), borshString(a.name.trim()), borshString(a.symbol), borshString(a.uri.trim()), fee, m.raw.creators, m.raw.collection, m.raw.uses])
        : Buffer.from([0]); // keep data
      // UpdateMetadataAccountV2 (15): Option<DataV2>, Option<new update authority>, Option<primary sale>, Option<is_mutable>
      const body = Buffer.concat([Buffer.from([15]), data, Buffer.from([0]), Buffer.from([0]), a.kind === "lockMetadata" ? Buffer.from([1, 0]) : Buffer.from([0])]);
      if (a.kind === "updateMetadata") {
        need(!!a.name.trim() && utf8(a.name).length <= 32, "Name must be 1–32 bytes.");
        need(/^[A-Za-z0-9$._-]{1,10}$/.test(a.symbol), "Symbol must be 1–10 letters/numbers.");
        need(utf8(a.uri.trim()).length <= 200, "Metadata link must be at most 200 bytes.");
        need(a.uri.trim() === "" || /^(https:\/\/|ipfs:\/\/|ar:\/\/)/.test(a.uri.trim()), "Metadata link must start with https://, ipfs:// or ar://.");
      }
      ix.push(new TransactionInstruction({ programId: mdProg, keys: [{ pubkey: metadata, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false }], data: body }));
      break;
    }
  }
  const tx = new Transaction({ feePayer: me, recentBlockhash: blockhash });
  tx.add(...ix);
  return tx;
}

/** Simulate, ask the wallet to sign, send and wait for confirmation. */
export class SimulationError extends Error {
  constructor(message: string, readonly logs: string[]) { super(message); this.name = "SimulationError"; }
}

/** Simulate, ask the wallet to sign, send and wait for confirmation. Simulation failures carry the program logs. */
export async function runManage(s: SolanaTokenState, owner: string, a: ManageAction, sign: (tx: Transaction) => Promise<{ serialize(): Uint8Array }>): Promise<string> {
  const latest = async () => (await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }])).value;
  const probe = await buildManageTransaction(s, owner, a, (await latest()).blockhash);
  const sim = await simulate(probe);
  if (sim.err) {
    const logs = sim.logs ?? [];
    const tail = logs.filter((l) => /Program log:|failed|Error/i.test(l)).slice(-4).join("\n");
    throw new SimulationError(`${explainSimulation(sim, "manage")}${tail ? `\n\nProgram logs:\n${tail}` : ""}`, logs);
  }
  // Size the compute limit from the simulation and use a fresh blockhash for the signed transaction.
  const { blockhash, lastValidBlockHeight } = await latest();
  const tx = await buildManageTransaction(s, owner, a, blockhash, computeLimitFrom(sim.unitsConsumed));
  const signed = await sign(tx);
  const sig = await sendSigned(signed);
  await confirmSignature(sig, lastValidBlockHeight);
  return sig;
}

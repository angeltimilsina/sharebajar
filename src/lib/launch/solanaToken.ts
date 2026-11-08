"use client";
import { Buffer } from "buffer";
import type { Keypair, PublicKey as PK, Transaction, TransactionInstruction as TI } from "@solana/web3.js";

/**
 * Solana token launch, built entirely in the browser and signed by the
 * creator's own wallet (plus a one-time mint keypair generated locally and
 * discarded). Bajar never holds any key or authority over the token.
 *
 * Instructions (one transaction):
 *  1. create the mint account (rent-exempt, SPL Token program)
 *  2. InitializeMint2 — decimals, mint authority = creator, freeze authority = creator or none
 *  3. Metaplex CreateMetadataAccountV3 — name, symbol, metadata URI, mutability
 *  4. create the creator's token account (idempotent) and mint the full supply to it
 *  5. optionally revoke the mint authority (fixed supply)
 *  6. optionally the disclosed launch fee (USDC) to the Bajar treasury
 */
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MINT_SIZE = 82;
export const TOKEN_ACCOUNT_SIZE = 165;
export const METADATA_SIZE = 679;

export interface LaunchParams {
  payer: string;
  name: string;            // ≤ 32 bytes
  symbol: string;          // ≤ 10 bytes
  uri: string;             // ≤ 200 bytes (JSON metadata)
  decimals: number;        // 0–9
  supply: bigint;          // whole tokens
  revokeMint: boolean;     // fixed supply
  revokeFreeze: boolean;   // no freeze authority
  immutable: boolean;      // metadata can't be changed later
  launchFee?: { amountRaw: bigint; recipientOwner: string } | null; // USDC (6 decimals)
}

const utf8 = (s: string) => Buffer.from(s, "utf8");
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n, 0); return b; };
const borshString = (s: string) => Buffer.concat([u32(utf8(s).length), utf8(s)]);

export function validateLaunch(p: Pick<LaunchParams, "name" | "symbol" | "uri" | "decimals" | "supply">): string | null {
  if (!p.name.trim() || utf8(p.name).length > 32) return "Name must be 1–32 bytes.";
  if (!/^[A-Za-z0-9$._-]{1,10}$/.test(p.symbol)) return "Symbol must be 1–10 letters/numbers.";
  if (utf8(p.uri).length > 200) return "Metadata URI must be at most 200 bytes.";
  if (p.uri && !/^(https:\/\/|ipfs:\/\/|ar:\/\/)/.test(p.uri)) return "Metadata URI must start with https://, ipfs:// or ar://.";
  if (!Number.isInteger(p.decimals) || p.decimals < 0 || p.decimals > 9) return "Decimals must be between 0 and 9.";
  if (p.supply <= BigInt(0)) return "Supply must be greater than zero.";
  if (p.supply * BigInt(10) ** BigInt(p.decimals) > BigInt("18446744073709551615")) return "Supply × 10^decimals exceeds the SPL maximum (u64). Lower the supply or decimals.";
  return null;
}

/** Borsh data for Metaplex CreateMetadataAccountV3 (discriminator 33). */
export function metadataV3Data(name: string, symbol: string, uri: string, isMutable: boolean): Buffer {
  return Buffer.concat([
    Buffer.from([33]),
    borshString(name), borshString(symbol), borshString(uri),
    Buffer.from([0, 0]),        // seller_fee_basis_points: u16 = 0
    Buffer.from([0]),           // creators: None
    Buffer.from([0]),           // collection: None
    Buffer.from([0]),           // uses: None
    Buffer.from([isMutable ? 1 : 0]),
    Buffer.from([0]),           // collection_details: None
  ]);
}

export async function buildLaunchTransaction(p: LaunchParams, chain: { blockhash: string; rent: { mint: number } }): Promise<{ tx: Transaction; mint: Keypair; mintAddress: string; ata: string }> {
  const err = validateLaunch(p);
  if (err) throw new Error(err);
  const w3 = await import("@solana/web3.js");
  const { PublicKey, Keypair, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } = w3;
  const payer = new PublicKey(p.payer);
  const mint = Keypair.generate();
  const tokenProg = new PublicKey(TOKEN_PROGRAM), ataProg = new PublicKey(ATA_PROGRAM), mdProg = new PublicKey(METADATA_PROGRAM);
  const ataOf = (owner: PK, m: PK) => PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProg.toBuffer(), m.toBuffer()], ataProg)[0];
  const ata = ataOf(payer, mint.publicKey);
  const [metadata] = PublicKey.findProgramAddressSync([utf8("metadata"), mdProg.toBuffer(), mint.publicKey.toBuffer()], mdProg);
  const raw = p.supply * BigInt(10) ** BigInt(p.decimals);
  const ix: TI[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 160_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })];

  ix.push(SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: mint.publicKey, lamports: chain.rent.mint, space: MINT_SIZE, programId: tokenProg }));
  // InitializeMint2 (20): decimals, mint authority, freeze authority option
  ix.push(new TransactionInstruction({
    programId: tokenProg, keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }],
    data: Buffer.concat([Buffer.from([20, p.decimals]), payer.toBuffer(), p.revokeFreeze ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), payer.toBuffer()])]),
  }));
  ix.push(new TransactionInstruction({
    programId: mdProg,
    keys: [
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: mint.publicKey, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: false },   // mint authority
      { pubkey: payer, isSigner: true, isWritable: true },    // payer
      { pubkey: payer, isSigner: true, isWritable: false },   // update authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: metadataV3Data(p.name.trim(), p.symbol, p.uri, !p.immutable),
  }));
  const createAta = (owner: PK, account: PK, m: PK) => new TransactionInstruction({
    programId: ataProg, data: Buffer.from([1]), // CreateIdempotent
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: m, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: tokenProg, isSigner: false, isWritable: false },
    ],
  });
  ix.push(createAta(payer, ata, mint.publicKey));
  // MintTo (7)
  ix.push(new TransactionInstruction({
    programId: tokenProg,
    keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: payer, isSigner: true, isWritable: false }],
    data: Buffer.concat([Buffer.from([7]), u64(raw)]),
  }));
  // SetAuthority (6): MintTokens (0) → None
  if (p.revokeMint) {
    ix.push(new TransactionInstruction({
      programId: tokenProg, keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }, { pubkey: payer, isSigner: true, isWritable: false }],
      data: Buffer.from([6, 0, 0]),
    }));
  }
  if (p.launchFee && p.launchFee.amountRaw > BigInt(0)) {
    const usdc = new PublicKey(USDC_MINT), owner = new PublicKey(p.launchFee.recipientOwner);
    const from = ataOf(payer, usdc), to = ataOf(owner, usdc);
    ix.push(createAta(owner, to, usdc));
    // TransferChecked (12)
    ix.push(new TransactionInstruction({
      programId: tokenProg,
      keys: [{ pubkey: from, isSigner: false, isWritable: true }, { pubkey: usdc, isSigner: false, isWritable: false }, { pubkey: to, isSigner: false, isWritable: true }, { pubkey: payer, isSigner: true, isWritable: false }],
      data: Buffer.concat([Buffer.from([12]), u64(p.launchFee.amountRaw), Buffer.from([6])]),
    }));
  }
  const tx = new Transaction({ feePayer: payer, recentBlockhash: chain.blockhash });
  tx.add(...ix);
  tx.partialSign(mint);
  return { tx, mint, mintAddress: mint.publicKey.toBase58(), ata: ata.toBase58() };
}

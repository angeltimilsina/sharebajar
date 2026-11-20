"use client";
import { Buffer } from "buffer";
import type { Transaction } from "@solana/web3.js";

/**
 * Create a Raydium CPMM pool (TOKEN / SOL) from the creator's wallet, right
 * after launch. One transaction: wrap the SOL side into WSOL, then Raydium's
 * `initialize`, which creates the pool, deposits both sides and mints LP
 * tokens to the creator. Raydium charges its own pool-creation fee (read from
 * the AMM config on-chain, 0.15 SOL at the time of writing). Bajar takes no
 * part of the pool and never holds the LP tokens.
 */
export const CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
/** Standard 0.25% fee tier (AMM config index 0). */
export const CPMM_CONFIG = "D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2";
export const CPMM_FEE_RECEIVER = "DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8";
const WSOL = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const INIT_DISC = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };

export interface PoolPlan { mint: string; tokenAmountRaw: bigint; solLamports: bigint; tokenProgram?: string }

/** Read Raydium's current pool-creation fee from the AMM config account. */
export function createFeeFromConfig(data: Buffer): bigint {
  // AmmConfig: discriminator 8, bump u8, disable_create_pool bool, index u16, trade/protocol/fund fee rates u64×3, create_pool_fee u64
  return data.readBigUInt64LE(8 + 1 + 1 + 2 + 8 * 3);
}

export async function buildCreatePool(creator: string, p: PoolPlan, blockhash: string, computeUnits = 400_000, config = CPMM_CONFIG): Promise<{ tx: Transaction; pool: string; lpMint: string }> {
  const { PublicKey, Transaction, TransactionInstruction, SystemProgram, ComputeBudgetProgram, SYSVAR_RENT_PUBKEY } = await import("@solana/web3.js");
  const prog = new PublicKey(CPMM_PROGRAM), cfg = new PublicKey(config), me = new PublicKey(creator);
  const tok = new PublicKey(TOKEN_PROGRAM), ataProg = new PublicKey(ATA_PROGRAM), wsol = new PublicKey(WSOL), mint = new PublicKey(p.mint);
  const mintProg = new PublicKey(p.tokenProgram ?? TOKEN_PROGRAM);
  // Raydium orders the pair by mint address bytes.
  const [m0, m1] = Buffer.compare(mint.toBuffer(), wsol.toBuffer()) < 0 ? [mint, wsol] : [wsol, mint];
  const amt0 = m0.equals(mint) ? p.tokenAmountRaw : p.solLamports;
  const amt1 = m0.equals(mint) ? p.solLamports : p.tokenAmountRaw;
  const prog0 = m0.equals(mint) ? mintProg : tok, prog1 = m1.equals(mint) ? mintProg : tok;
  const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, prog)[0];
  const authority = pda([Buffer.from("vault_and_lp_mint_auth_seed")]);
  const pool = pda([Buffer.from("pool"), cfg.toBuffer(), m0.toBuffer(), m1.toBuffer()]);
  const lpMint = pda([Buffer.from("pool_lp_mint"), pool.toBuffer()]);
  const vault0 = pda([Buffer.from("pool_vault"), pool.toBuffer(), m0.toBuffer()]);
  const vault1 = pda([Buffer.from("pool_vault"), pool.toBuffer(), m1.toBuffer()]);
  const observation = pda([Buffer.from("observation"), pool.toBuffer()]);
  const ata = (owner: InstanceType<typeof PublicKey>, m: InstanceType<typeof PublicKey>, tp: InstanceType<typeof PublicKey>) => PublicKey.findProgramAddressSync([owner.toBuffer(), tp.toBuffer(), m.toBuffer()], ataProg)[0];
  const myWsol = ata(me, wsol, tok);
  const my0 = ata(me, m0, prog0), my1 = ata(me, m1, prog1), myLp = ata(me, lpMint, tok);

  const tx = new Transaction({ feePayer: me, recentBlockhash: blockhash });
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    // Wrap the SOL side: WSOL account (idempotent), move lamports in, sync.
    new TransactionInstruction({ programId: ataProg, data: Buffer.from([1]), keys: [
      { pubkey: me, isSigner: true, isWritable: true }, { pubkey: myWsol, isSigner: false, isWritable: true }, { pubkey: me, isSigner: false, isWritable: false },
      { pubkey: wsol, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: tok, isSigner: false, isWritable: false },
    ] }),
    SystemProgram.transfer({ fromPubkey: me, toPubkey: myWsol, lamports: p.solLamports }),
    new TransactionInstruction({ programId: tok, data: Buffer.from([17]), keys: [{ pubkey: myWsol, isSigner: false, isWritable: true }] }), // SyncNative
    new TransactionInstruction({
      programId: prog,
      data: Buffer.concat([INIT_DISC, u64(amt0), u64(amt1), u64(BigInt(0))]), // open_time 0 = open now
      keys: [
        { pubkey: me, isSigner: true, isWritable: true },
        { pubkey: cfg, isSigner: false, isWritable: false },
        { pubkey: authority, isSigner: false, isWritable: false },
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: m0, isSigner: false, isWritable: false },
        { pubkey: m1, isSigner: false, isWritable: false },
        { pubkey: lpMint, isSigner: false, isWritable: true },
        { pubkey: my0, isSigner: false, isWritable: true },
        { pubkey: my1, isSigner: false, isWritable: true },
        { pubkey: myLp, isSigner: false, isWritable: true },
        { pubkey: vault0, isSigner: false, isWritable: true },
        { pubkey: vault1, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(CPMM_FEE_RECEIVER), isSigner: false, isWritable: true },
        { pubkey: observation, isSigner: false, isWritable: true },
        { pubkey: tok, isSigner: false, isWritable: false },
        { pubkey: prog0, isSigner: false, isWritable: false },
        { pubkey: prog1, isSigner: false, isWritable: false },
        { pubkey: ataProg, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
    }),
  );
  return { tx, pool: pool.toBase58(), lpMint: lpMint.toBase58() };
}

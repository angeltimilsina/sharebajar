"use client";
import { Buffer } from "buffer";
import { rpc } from "../wallet/rpc";

/**
 * Cross-wallet transfers, built locally in the browser (no third-party
 * builder): SOL / SPL tokens on Solana, native coins / ERC-20 on EVM.
 * The sending wallet signs; nothing here holds or sees a key.
 */
export const WSOL = "So11111111111111111111111111111111111111112";
export const NATIVE_EVM = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** Decimal string → integer base units (no floating point). */
export function toBaseUnits(amount: string, decimals: number): bigint | null {
  if (!/^\d*\.?\d*$/.test(amount) || amount === "" || amount === ".") return null;
  const [i, f = ""] = amount.split(".");
  if (f.length > decimals) return null;
  const v = BigInt((i || "0") + f.padEnd(decimals, "0"));
  return v > BigInt(0) ? v : null;
}

/** Unsigned Solana transfer (base64 v0 transaction) from → to. */
export async function buildSolanaTransfer(p: { from: string; to: string; mint: string; amount: bigint; decimals: number }): Promise<string> {
  const { PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = await import("@solana/web3.js");
  const from = new PublicKey(p.from), to = new PublicKey(p.to);
  const { value: bh } = await rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const ixs = [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 })];
  if (p.mint === WSOL) {
    ixs.push(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: p.amount }));
  } else {
    const mint = new PublicKey(p.mint);
    // Which token program owns this mint (SPL Token or Token-2022)?
    const acct = await rpc<{ value: { owner: string } | null }>("getAccountInfo", [p.mint, { encoding: "base64" }]);
    if (!acct.value) throw new Error("Token mint not found on-chain.");
    const tokenProgram = new PublicKey(acct.value.owner);
    const ataProg = new PublicKey(ATA_PROGRAM);
    const ata = (owner: InstanceType<typeof PublicKey>) => PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ataProg)[0];
    const src = ata(from), dst = ata(to);
    // Create the recipient's token account if needed (idempotent), paid by the sender.
    ixs.push(new TransactionInstruction({
      programId: ataProg, data: Buffer.from([1]),
      keys: [
        { pubkey: from, isSigner: true, isWritable: true }, { pubkey: dst, isSigner: false, isWritable: true },
        { pubkey: to, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
    }));
    // TransferChecked (12): amount u64 LE + decimals.
    const data = Buffer.alloc(10);
    data.writeUInt8(12, 0); data.writeBigUInt64LE(p.amount, 1); data.writeUInt8(p.decimals, 9);
    ixs.push(new TransactionInstruction({
      programId: tokenProgram, data,
      keys: [{ pubkey: src, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: from, isSigner: true, isWritable: false }],
    }));
  }
  const msg = new TransactionMessage({ payerKey: from, recentBlockhash: bh.blockhash, instructions: ixs }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

/** EVM transfer call: native value transfer or ERC-20 transfer(to, amount). */
export function evmTransferTx(p: { from: string; to: string; token: string; amount: bigint }): { from: string; to: string; value: string; data?: string } {
  if (p.token.toLowerCase() === NATIVE_EVM.toLowerCase()) return { from: p.from, to: p.to, value: `0x${p.amount.toString(16)}` };
  const data = `0xa9059cbb${p.to.toLowerCase().replace(/^0x/, "").padStart(64, "0")}${p.amount.toString(16).padStart(64, "0")}`;
  return { from: p.from, to: p.token, value: "0x0", data };
}

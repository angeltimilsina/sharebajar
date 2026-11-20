"use client";
import { Buffer } from "buffer";
import { ATA_PROGRAM, TOKEN_PROGRAM, USDC_MINT } from "@/lib/launch/solanaToken";

const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch("/api/wallet/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "solana", method, params }) });
  const b = await r.json();
  if (b.error) throw new Error(b.error.message ?? String(b.error));
  return b.result as T;
}

/**
 * The Pro payment: one USDC transfer from your wallet to Bajar's treasury,
 * with a memo naming the plan. Simulated before you're asked to sign.
 */
export async function buildProPayment(payer: string, recipient: string, priceUsdc: number) {
  const { PublicKey, Transaction, TransactionInstruction, SystemProgram, ComputeBudgetProgram } = await import("@solana/web3.js");
  const me = new PublicKey(payer), to = new PublicKey(recipient), usdc = new PublicKey(USDC_MINT), tok = new PublicKey(TOKEN_PROGRAM), ataProg = new PublicKey(ATA_PROGRAM);
  const ata = (o: InstanceType<typeof PublicKey>) => PublicKey.findProgramAddressSync([o.toBuffer(), tok.toBuffer(), usdc.toBuffer()], ataProg)[0];
  const from = ata(me), dest = ata(to);
  const amount = Buffer.alloc(8); amount.writeBigUInt64LE(BigInt(Math.round(priceUsdc * 1e6)));
  const { value: { blockhash } } = await rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = new Transaction({ feePayer: me, recentBlockhash: blockhash });
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    new TransactionInstruction({ programId: ataProg, data: Buffer.from([1]), keys: [
      { pubkey: me, isSigner: true, isWritable: true }, { pubkey: dest, isSigner: false, isWritable: true }, { pubkey: to, isSigner: false, isWritable: false },
      { pubkey: usdc, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: tok, isSigner: false, isWritable: false },
    ] }),
    new TransactionInstruction({ programId: tok, data: Buffer.concat([Buffer.from([12]), amount, Buffer.from([6])]), keys: [
      { pubkey: from, isSigner: false, isWritable: true }, { pubkey: usdc, isSigner: false, isWritable: false }, { pubkey: dest, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false },
    ] }),
    new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), data: Buffer.from("Bajar Pro", "utf8"), keys: [{ pubkey: me, isSigner: true, isWritable: false }] }),
  );
  const sim = await rpc<{ value: { err: unknown; logs?: string[] } }>("simulateTransaction", [Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
  if (sim.value.err) throw new Error(/insufficient|0x1\b/i.test(JSON.stringify(sim.value.logs ?? sim.value.err)) ? `Not enough USDC (or SOL for the network fee) in this wallet.` : `Simulation failed: ${JSON.stringify(sim.value.err)}`);
  return tx;
}

export async function sendAndConfirm(serialized: Uint8Array): Promise<string> {
  const sig = await rpc<string>("sendTransaction", [Buffer.from(serialized).toString("base64"), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await rpc<{ value: ({ err: unknown; confirmationStatus: string } | null)[] }>("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]).catch(() => null);
    const v = st?.value[0];
    if (v?.err) throw new Error("Payment failed on-chain. No USDC was taken.");
    if (v && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) return sig;
  }
  return sig;
}

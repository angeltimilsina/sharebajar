import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { assertSafeSolanaSwap, assertSafeZeroxQuote, describeEvmCall, inspectSolanaTx, SOL_TOKEN, ZEROX_ALLOWANCE_HOLDERS } from "@/lib/wallet/txguard";

const BH = "11111111111111111111111111111111";
const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");
function build(payer: PublicKey, ixs: TransactionInstruction[]) {
  return b64(new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: BH, instructions: ixs }).compileToV0Message()));
}
const user = Keypair.generate().publicKey;
const other = Keypair.generate().publicKey;
const transfer = SystemProgram.transfer({ fromPubkey: user, toPubkey: other, lamports: 1000 });
const tokenIx = (tag: number) => new TransactionInstruction({ programId: new PublicKey(SOL_TOKEN), keys: [{ pubkey: other, isSigner: false, isWritable: true }, { pubkey: user, isSigner: true, isWritable: false }], data: Buffer.from([tag, 1, 0, 0, 0, 0, 0, 0, 0]) });

describe("Solana pre-sign guard", () => {
  it("accepts a plain transaction paid by the user", async () => {
    await expect(assertSafeSolanaSwap(build(user, [transfer]), user.toBase58())).resolves.toBeUndefined();
  });
  it("blocks a transaction paid by someone else", async () => {
    await expect(assertSafeSolanaSwap(build(other, [transfer]), user.toBase58())).rejects.toThrow(/isn't paid by your wallet/);
  });
  it("blocks token delegate approvals and authority changes", async () => {
    await expect(assertSafeSolanaSwap(build(user, [transfer, tokenIx(4)]), user.toBase58())).rejects.toThrow(/delegate/);
    await expect(assertSafeSolanaSwap(build(user, [tokenIx(13)]), user.toBase58())).rejects.toThrow(/ApproveChecked/);
    await expect(assertSafeSolanaSwap(build(user, [tokenIx(6)]), user.toBase58())).rejects.toThrow(/SetAuthority/);
  });
  it("blocks reassigning the payer's account", async () => {
    const assign = SystemProgram.assign({ accountPubkey: user, programId: other });
    expect((await inspectSolanaTx(build(user, [assign]))).risks[0]).toMatch(/reassigns ownership/);
  });
  it("token transfers are fine", async () => {
    expect((await inspectSolanaTx(build(user, [tokenIx(3)]))).risks).toEqual([]);
  });
});

describe("EVM call descriptions and 0x guard", () => {
  const spender = "0x0000000000001ff3684f28c67538d4d072c22734";
  const pad = (h: string) => h.replace(/^0x/, "").padStart(64, "0");
  it("flags unlimited approvals but not exact ones", () => {
    const max = "f".repeat(64);
    expect(describeEvmCall("0xt", `0x095ea7b3${pad(spender)}${max}`).risk).toMatch(/unlimited/);
    expect(describeEvmCall("0xt", `0x095ea7b3${pad(spender)}${pad("0x4c4b40")}`)).toMatchObject({ action: "Token approval", risk: undefined });
    expect(describeEvmCall("0xt", `0xa22cb465${pad(spender)}${pad("0x1")}`).risk).toMatch(/every item/);
  });
  it("only allows the 0x allowance contract", () => {
    const good = { allowanceTarget: spender, issues: { allowance: { spender } }, transaction: { to: spender } };
    expect(() => assertSafeZeroxQuote(good)).not.toThrow();
    expect(ZEROX_ALLOWANCE_HOLDERS).toContain(spender);
    expect(() => assertSafeZeroxQuote({ ...good, issues: { allowance: { spender: "0x000000000000000000000000000000000000dead" } } })).toThrow(/unknown spender/);
    expect(() => assertSafeZeroxQuote({ ...good, transaction: { to: "0x000000000000000000000000000000000000beef" } })).toThrow(/different contract/);
    expect(() => assertSafeZeroxQuote({ allowanceTarget: null, issues: null, transaction: { to: "0xabc" } })).not.toThrow(); // native sell: no approval
  });
});

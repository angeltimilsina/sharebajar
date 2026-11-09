"use client";
import { Buffer } from "buffer";
import type { Transaction, TransactionInstruction as TI } from "@solana/web3.js";
import { ATA_PROGRAM, METADATA_PROGRAM, TOKEN_PROGRAM } from "./solanaToken";

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
  metadata: { updateAuthority: string; isMutable: boolean; name: string; symbol: string; uri: string } | null;
  balanceRaw: bigint;
  tokenProgram: string;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch("/api/wallet/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "solana", method, params }) });
  const b = await r.json();
  if (b.error) throw new Error(b.error.message ?? String(b.error));
  return b.result as T;
}

export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PE8hwvR3mmLNiVY5U";

const utf8 = (s: string) => Buffer.from(s, "utf8");
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n, 0); return b; };
const borshString = (s: string) => Buffer.concat([u32(utf8(s).length), utf8(s)]);

/** Parse a Metaplex metadata account (key, update authority, mint, data, flags). */
export function parseMetadata(b: Buffer, toB58: (x: Buffer) => string) {
  let o = 1;
  const updateAuthority = toB58(b.subarray(o, o + 32)); o += 64;
  const str = () => { const n = b.readUInt32LE(o); o += 4; const s = b.subarray(o, o + n).toString("utf8").replace(/\0+$/, ""); o += n; return s; };
  const name = str(), symbol = str(), uri = str();
  o += 2; // seller fee
  if (b[o++] === 1) { const n = b.readUInt32LE(o); o += 4 + n * 34; } // creators
  o += 1; // primary_sale_happened
  const isMutable = b[o] === 1;
  return { updateAuthority, isMutable, name, symbol, uri };
}

export async function readSolanaToken(mint: string, owner: string): Promise<SolanaTokenState> {
  const { PublicKey } = await import("@solana/web3.js");
  const acc = await rpc<{ value: { owner: string; data: { parsed?: { type: string; info: { decimals: number; supply: string; mintAuthority: string | null; freezeAuthority: string | null } } } } | null }>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const info = acc.value?.data?.parsed?.type === "mint" ? acc.value.data.parsed.info : null;
  if (!info || !acc.value) throw new Error("Mint account not found.");
  const mdProg = new PublicKey(METADATA_PROGRAM);
  const [pda] = PublicKey.findProgramAddressSync([utf8("metadata"), mdProg.toBuffer(), new PublicKey(mint).toBuffer()], mdProg);
  const md = await rpc<{ value: { data: [string, string] } | null }>("getAccountInfo", [pda.toBase58(), { encoding: "base64" }]);
  const metadata = md.value ? parseMetadata(Buffer.from(md.value.data[0], "base64"), (x) => new PublicKey(x).toBase58()) : null;
  const ata = PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(acc.value.owner).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA_PROGRAM))[0];
  const bal = await rpc<{ value: { data: { parsed?: { info: { tokenAmount: { amount: string } } } } } | null }>("getAccountInfo", [ata.toBase58(), { encoding: "jsonParsed" }]);
  return {
    mint, decimals: info.decimals, supplyRaw: BigInt(info.supply), mintAuthority: info.mintAuthority, freezeAuthority: info.freezeAuthority,
    metadata, balanceRaw: BigInt(bal.value?.data?.parsed?.info.tokenAmount.amount ?? "0"), tokenProgram: acc.value.owner,
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
  const fmt = (r: bigint) => (Number(r) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: decimals });
  switch (a.kind) {
    case "revokeMint": return `Permanently revoke the mint authority of ${symbol}. Nobody, including you, can ever create more.`;
    case "revokeFreeze": return `Permanently revoke the freeze authority of ${symbol}. Nobody can freeze holders' tokens.`;
    case "burn": return `Burn ${fmt(a.amountRaw)} ${symbol} from your wallet. This lowers the total supply and can't be undone.`;
    case "mint": return `Mint ${fmt(a.amountRaw)} new ${symbol} to your wallet. This increases the total supply.`;
    case "updateMetadata": return `Change ${symbol}'s on-chain name to "${a.name}", symbol to "${a.symbol}" and metadata link.`;
    case "lockMetadata": return `Permanently lock ${symbol}'s metadata. Name, symbol and image can never change again.`;
  }
}

export async function buildManageTransaction(s: SolanaTokenState, owner: string, a: ManageAction, blockhash: string): Promise<Transaction> {
  const { PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } = await import("@solana/web3.js");
  const me = new PublicKey(owner), mint = new PublicKey(s.mint), prog = new PublicKey(s.tokenProgram);
  if (s.tokenProgram !== TOKEN_PROGRAM && s.tokenProgram !== TOKEN_2022) throw new Error("Unsupported token program.");
  const ata = PublicKey.findProgramAddressSync([me.toBuffer(), prog.toBuffer(), mint.toBuffer()], new PublicKey(ATA_PROGRAM))[0];
  const ix: TI[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })];
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
      // MintToChecked (14), to your own token account (it exists from the launch)
      ix.push(new TransactionInstruction({ programId: prog, keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false }], data: Buffer.concat([Buffer.from([14]), u64(a.amountRaw), Buffer.from([s.decimals])]) }));
      break;
    case "updateMetadata":
    case "lockMetadata": {
      need(!!s.metadata && s.metadata.isMutable && s.metadata.updateAuthority === owner, "Metadata is locked or owned by another wallet.");
      const m = s.metadata!;
      const data = a.kind === "updateMetadata"
        ? Buffer.concat([Buffer.from([1]), borshString(a.name), borshString(a.symbol), borshString(a.uri), Buffer.from([0, 0]), Buffer.from([0]), Buffer.from([0]), Buffer.from([0])])
        : Buffer.from([0]); // keep data
      // UpdateMetadataAccountV2 (15): Option<DataV2>, Option<new update authority>, Option<primary sale>, Option<is_mutable>
      const body = Buffer.concat([Buffer.from([15]), data, Buffer.from([0]), Buffer.from([0]), a.kind === "lockMetadata" ? Buffer.from([1, 0]) : Buffer.from([0])]);
      if (a.kind === "updateMetadata") {
        need(!!a.name.trim() && utf8(a.name).length <= 32, "Name must be 1–32 bytes.");
        need(/^[A-Za-z0-9$._-]{1,10}$/.test(a.symbol), "Symbol must be 1–10 letters/numbers.");
        need(utf8(a.uri).length <= 200 && (a.uri === "" || /^(https:\/\/|ipfs:\/\/|ar:\/\/)/.test(a.uri)), "Metadata link must start with https://, ipfs:// or ar://.");
      }
      void m;
      ix.push(new TransactionInstruction({ programId: mdProg, keys: [{ pubkey: metadata, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false }], data: body }));
      break;
    }
  }
  const tx = new Transaction({ feePayer: me, recentBlockhash: blockhash });
  tx.add(...ix);
  return tx;
}

/** Simulate, ask the wallet to sign, send and wait for confirmation. */
export async function runManage(s: SolanaTokenState, owner: string, a: ManageAction, sign: (tx: Transaction) => Promise<{ serialize(): Uint8Array }>): Promise<string> {
  const { value: { blockhash } } = await rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = await buildManageTransaction(s, owner, a, blockhash);
  const sim = await rpc<{ value: { err: unknown; logs?: string[] } }>("simulateTransaction", [Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
  if (sim.value.err) throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
  const signed = await sign(tx);
  const sig = await rpc<string>("sendTransaction", [Buffer.from(signed.serialize()).toString("base64"), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await rpc<{ value: ({ err: unknown; confirmationStatus: string } | null)[] }>("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]).catch(() => null);
    const v = st?.value[0];
    if (v?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(v.err)}`);
    if (v && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) return sig;
  }
  return sig;
}

/**
 * Pre-signing checks for transactions Bajar asks a wallet to sign.
 * Swaps are built by route providers (Jupiter, 0x); before the user's wallet
 * is asked to sign, we verify the transaction does only what a swap should.
 * A failure here blocks the request — it never reaches the wallet.
 */

/* --------------------------------- Solana -------------------------------- */

export const SOL_SYSTEM = "11111111111111111111111111111111";
export const SOL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SOL_TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export interface SolanaInspection {
  feePayer: string;
  programs: string[];
  /** Instructions that hand control of the user's assets to someone else. */
  risks: string[];
}

/** Token-program instructions a swap never needs (drainer patterns). */
const TOKEN_RISKS: Record<number, string> = { 4: "grants a token spending delegate (Approve)", 13: "grants a token spending delegate (ApproveChecked)", 6: "changes a token account or mint authority (SetAuthority)" };

/** Inspect a (versioned or legacy) transaction message. Works with lookup tables: programs are always static keys. */
export async function inspectSolanaTx(base64OrBytes: string | Uint8Array): Promise<SolanaInspection> {
  const { VersionedTransaction } = await import("@solana/web3.js");
  const bytes = typeof base64OrBytes === "string" ? Uint8Array.from(atob(base64OrBytes), (c) => c.charCodeAt(0)) : base64OrBytes;
  const vt = VersionedTransaction.deserialize(bytes);
  const keys = vt.message.staticAccountKeys.map((k) => k.toBase58());
  const feePayer = keys[0];
  const programs = new Set<string>();
  const risks: string[] = [];
  for (const ix of vt.message.compiledInstructions) {
    const prog = keys[ix.programIdIndex];
    if (!prog) continue;
    programs.add(prog);
    const tag = ix.data[0];
    if ((prog === SOL_TOKEN || prog === SOL_TOKEN_2022) && tag !== undefined && TOKEN_RISKS[tag]) risks.push(TOKEN_RISKS[tag]);
    // System Assign (1) of the fee payer's account would hand the account itself to another program.
    if (prog === SOL_SYSTEM && tag === 1 && ix.accountKeyIndexes[0] === 0) risks.push("reassigns ownership of your account (System Assign)");
  }
  return { feePayer, programs: [...programs], risks };
}

/** Throw unless a swap transaction is paid by the user and grants nobody control of their assets. */
export async function assertSafeSolanaSwap(base64: string, owner: string): Promise<void> {
  const i = await inspectSolanaTx(base64);
  if (i.feePayer !== owner) throw new Error("Blocked: the swap transaction isn't paid by your wallet. Nothing was sent to your wallet for signing.");
  if (i.risks.length) throw new Error(`Blocked: the swap transaction ${i.risks[0]}. Swaps never need this, so it was not sent to your wallet.`);
}

/* ---------------------------------- EVM ---------------------------------- */

/** 0x AllowanceHolder contracts (Cancun and pre-Cancun chains). Approvals may only go here. */
export const ZEROX_ALLOWANCE_HOLDERS = ["0x0000000000001ff3684f28c67538d4d072c22734", "0x0000000000005e88410ccdfade4a5efae4b49562"];
const MAX_HALF = BigInt(2) ** BigInt(255);

export interface EvmCallInfo { action: string; detail?: string; risk?: string }

/** Human-readable summary of common token calls (approve, transfer, setApprovalForAll…). */
export function describeEvmCall(to: string, data: string | undefined): EvmCallInfo {
  const d = (data ?? "0x").toLowerCase();
  if (d === "0x" || d.length < 10) return { action: "Transfer native coin" };
  const sel = d.slice(0, 10);
  const word = (i: number) => d.slice(10 + i * 64, 10 + (i + 1) * 64);
  const addr = (i: number) => `0x${word(i).slice(24)}`;
  const num = (i: number) => (word(i) ? BigInt(`0x${word(i)}`) : BigInt(0));
  switch (sel) {
    case "0x095ea7b3": {
      const amt = num(1);
      const unlimited = amt >= MAX_HALF;
      return { action: "Token approval", detail: `${unlimited ? "UNLIMITED" : amt.toString()} to ${addr(0)}`, risk: unlimited ? "This grants the spender unlimited access to this token. Only approve unlimited amounts for contracts you fully trust." : undefined };
    }
    case "0x39509351": return { action: "Increase token allowance", detail: `+${num(1).toString()} to ${addr(0)}`, risk: num(1) >= MAX_HALF ? "This grants the spender unlimited access to this token." : undefined };
    case "0xa22cb465": return { action: "Collection approval", detail: `${num(1) ? "ALL items" : "revoke"} → ${addr(0)}`, risk: num(1) ? "This lets the operator move every item in this collection from your wallet." : undefined };
    case "0xa9059cbb": return { action: "Token transfer", detail: `${num(1).toString()} to ${addr(0)}` };
    case "0x23b872dd": return { action: "Token transferFrom", detail: `${num(2).toString()} from ${addr(0)} to ${addr(1)}` };
    default: return { action: "Contract call", detail: `${sel} on ${to}` };
  }
}

/** Throw unless a 0x quote's approval and transaction target the known allowance contract. */
export function assertSafeZeroxQuote(q: { allowanceTarget: string | null; issues: { allowance: { spender: string } | null } | null; transaction: { to: string } | null }): void {
  const known = (a: string | null | undefined) => !!a && ZEROX_ALLOWANCE_HOLDERS.includes(a.toLowerCase());
  const spender = q.issues?.allowance?.spender;
  if (spender && !known(spender)) throw new Error("Blocked: the quote asks to approve an unknown spender. Nothing was sent to your wallet.");
  if (q.allowanceTarget && !known(q.allowanceTarget)) throw new Error("Blocked: the quote's allowance target isn't the 0x allowance contract.");
  if (q.transaction && q.allowanceTarget && q.transaction.to.toLowerCase() !== q.allowanceTarget.toLowerCase()) throw new Error("Blocked: the swap transaction targets a different contract than the one you approve.");
}

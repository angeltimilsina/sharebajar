import { NextResponse } from "next/server";
import { z } from "zod";
import { srpc } from "@/lib/treasury/solana";
import { erpc } from "@/lib/treasury/evm";
import { getChain } from "@/lib/chains";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { crossSiteRejection } from "@/lib/server/guard";

const BROADCAST = new Set(["sendTransaction", "eth_sendRawTransaction"]);
/** Per-method shape checks: the relay forwards only well-formed, size-bounded requests. */
function validParams(method: string, params: unknown[]): string | null {
  const first = params[0];
  if (method === "sendTransaction") return typeof first === "string" && first.length <= 1700 && /^[A-Za-z0-9+/=]+$/.test(first) ? null : "Signed Solana transaction must be base64 ≤ 1232 bytes";
  if (method === "simulateTransaction") return typeof first === "string" && first.length <= 1700 ? null : "Transaction too large";
  if (method === "getTokenAccountsByOwner") {
    // Only "token accounts of <owner> under the SPL Token / Token-2022 program".
    const filter = params[1] as { programId?: string } | undefined;
    return typeof first === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(first) && ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"].includes(filter?.programId ?? "") ? null : "Invalid token-accounts query";
  }
  if (method === "eth_sendRawTransaction") return typeof first === "string" && /^0x[0-9a-fA-F]+$/.test(first) && first.length <= 262_144 ? null : "Signed EVM transaction must be hex ≤ 128 KB";
  return null;
}

/** Allowlisted JSON-RPC relay for Bajar Wallet (reads, simulation, broadcast of signed txs). */
const SOL = new Set(["getLatestBlockhash", "getBalance", "getTokenAccountsByOwner", "getAccountInfo", "getMultipleAccounts", "simulateTransaction", "sendTransaction", "getSignatureStatuses", "getSignaturesForAddress", "getTransaction", "getMinimumBalanceForRentExemption", "getFeeForMessage", "getRecentPrioritizationFees", "getTokenLargestAccounts", "getTokenSupply"]);
const EVM = new Set(["eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getTransactionCount", "eth_sendRawTransaction", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_getCode"]);
const Body = z.object({ chain: z.string().max(20), method: z.string().max(60), params: z.array(z.unknown()).max(10) });

export async function POST(req: Request) {
  const blocked = crossSiteRejection(req);
  if (blocked) return NextResponse.json({ error: { message: "Cross-site request blocked" } }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > 300_000) return NextResponse.json({ error: { message: "Request too large" } }, { status: 413 });
  const rl = rateLimit(`wrpc:${clientIp(req)}`, 240, 240);
  if (!rl.ok) return NextResponse.json({ error: { message: "Too many requests" } }, { status: 429 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: { message: "Invalid request" } }, { status: 400 });
  const { chain, method, params } = p.data;
  const bad = validParams(method, params);
  if (bad) return NextResponse.json({ error: { message: bad } }, { status: 400 });
  if (BROADCAST.has(method)) {
    const b = rateLimit(`wbcast:${clientIp(req)}`, 20, 20);
    if (!b.ok) return NextResponse.json({ error: { message: "Too many broadcasts. Wait a minute." } }, { status: 429 });
  }
  const c = getChain(chain);
  try {
    if (chain === "solana") {
      if (!SOL.has(method)) return NextResponse.json({ error: { message: `Method ${method} not allowed` } }, { status: 403 });
      return NextResponse.json({ result: await srpc(method, params) });
    }
    if (!c || c.type !== "evm" || !EVM.has(method)) return NextResponse.json({ error: { message: "Method or chain not allowed" } }, { status: 403 });
    return NextResponse.json({ result: await erpc(chain, method, params) });
  } catch (e) {
    return NextResponse.json({ error: { message: String(e instanceof Error ? e.message : e).replace(/^.*RPC [^:]+: /, "").slice(0, 300) } }, { status: 200 });
  }
}

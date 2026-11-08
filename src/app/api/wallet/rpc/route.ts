import { NextResponse } from "next/server";
import { z } from "zod";
import { srpc } from "@/lib/treasury/solana";
import { erpc } from "@/lib/treasury/evm";
import { getChain } from "@/lib/chains";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

/** Allowlisted JSON-RPC relay for BAJAR Wallet (reads, simulation, broadcast of signed txs). */
const SOL = new Set(["getLatestBlockhash", "getBalance", "getAccountInfo", "getMultipleAccounts", "simulateTransaction", "sendTransaction", "getSignatureStatuses", "getSignaturesForAddress", "getTransaction", "getMinimumBalanceForRentExemption", "getFeeForMessage", "getRecentPrioritizationFees"]);
const EVM = new Set(["eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getTransactionCount", "eth_sendRawTransaction", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_getCode"]);
const Body = z.object({ chain: z.string().max(20), method: z.string().max(60), params: z.array(z.unknown()).max(10) });

export async function POST(req: Request) {
  const rl = rateLimit(`wrpc:${clientIp(req)}`, 240, 240);
  if (!rl.ok) return NextResponse.json({ error: { message: "Too many requests" } }, { status: 429 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: { message: "Invalid request" } }, { status: 400 });
  const { chain, method, params } = p.data;
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

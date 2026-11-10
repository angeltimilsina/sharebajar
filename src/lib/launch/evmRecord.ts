import "server-only";
import { decodeFunctionResult, encodeFunctionData, getAddress } from "viem";
import { q } from "@/lib/treasury/db";
import { erpc } from "@/lib/treasury/evm";
import { BAJAR_TOKEN_ABI, BAJAR_TOKEN_RUNTIME } from "./erc20Artifact";

type Read = "name" | "symbol" | "totalSupply";
async function read(chain: string, to: string, fn: Read) {
  const data = encodeFunctionData({ abi: BAJAR_TOKEN_ABI, functionName: fn });
  const out = await erpc<`0x${string}`>(chain, "eth_call", [{ to, data }, "latest"]);
  return decodeFunctionResult({ abi: BAJAR_TOKEN_ABI, functionName: fn, data: out });
}

/**
 * Records an EVM token launched through Bajar, only after checking on-chain
 * that the transaction succeeded, created a contract, and that the contract's
 * code is exactly BajarToken (fixed supply, no owner).
 */
export async function recordEvmLaunch(chain: "ethereum" | "base" | "bsc", hash: string): Promise<{ ok: true; token: string } | { ok: false; status: number; error: string }> {
  const rc = await erpc<{ status: string; contractAddress: string | null; from: string } | null>(chain, "eth_getTransactionReceipt", [hash]);
  if (!rc) return { ok: false, status: 404, error: "Transaction not found yet — try again in a few seconds." };
  if (rc.status !== "0x1") return { ok: false, status: 400, error: "Transaction failed on-chain." };
  if (!rc.contractAddress) return { ok: false, status: 400, error: "This transaction did not create a contract." };
  const token = getAddress(rc.contractAddress);
  const code = await erpc<string>(chain, "eth_getCode", [token, "latest"]);
  // A load-balanced RPC node can serve the receipt before its "latest" state has the code: retryable.
  if (!code || code === "0x") return { ok: false, status: 404, error: "Contract not visible yet — try again in a few seconds." };
  if (code.toLowerCase() !== BAJAR_TOKEN_RUNTIME.toLowerCase()) return { ok: false, status: 400, error: "Contract is not a Bajar token." };
  const [name, symbol, supply] = await Promise.all([read(chain, token, "name"), read(chain, token, "symbol"), read(chain, token, "totalSupply")]);
  await q(
    `insert into token_launches (mint, chain, name, symbol, creator, signature, metadata_uri, fixed_supply, freeze_revoked, supply, decimals)
     values ($1,$2,$3,$4,$5,$6,null,true,true,$7,18) on conflict (mint) do nothing`,
    [token, chain, String(name).slice(0, 64), String(symbol).slice(0, 16), getAddress(rc.from), hash, String(supply)],
  );
  return { ok: true, token };
}

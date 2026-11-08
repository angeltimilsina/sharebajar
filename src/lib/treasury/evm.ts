import "server-only";
import { getChain } from "../chains";
import { fetchUpstream } from "../server/http";

/** Server-side EVM JSON-RPC helpers (read-only). */
export function evmRpcUrl(chain: string, environment = "mainnet"): string {
  const c = getChain(chain);
  if (!c || c.type !== "evm") throw new Error(`Unsupported EVM chain ${chain}`);
  if (environment === "testnet") {
    const u = process.env[`RPC_URL_${chain.toUpperCase()}_TESTNET`];
    if (!u) throw new Error(`Set RPC_URL_${chain.toUpperCase()}_TESTNET to use ${c.name} testnet`);
    return u;
  }
  return c.rpc;
}

let rid = 1;
export async function erpc<T>(chain: string, method: string, params: unknown[], environment = "mainnet"): Promise<T> {
  const r = await fetchUpstream<{ result?: T; error?: { message: string } }>(evmRpcUrl(chain, environment), {
    method: "POST", body: { jsonrpc: "2.0", id: rid++, method, params }, timeoutMs: 15_000, retries: 1,
  });
  if (r.error) throw new Error(`${chain} RPC ${method}: ${r.error.message}`);
  return r.result as T;
}

export const isEvmAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const pad32 = (addr: string) => `0x${addr.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
export const topicToAddress = (t: string) => `0x${t.slice(-40)}`;
export const hexToBig = (h: string) => BigInt(h === "0x" ? "0x0" : h);

const call = (chain: string, to: string, data: string, environment = "mainnet") => erpc<string>(chain, "eth_call", [{ to, data }, "latest"], environment);

function decodeString(hex: string): string {
  const b = Buffer.from(hex.replace(/^0x/, ""), "hex");
  if (b.length === 32) return b.toString("utf8").replace(/\0+$/, ""); // bytes32 symbols (e.g. MKR)
  if (b.length < 64) return "";
  const len = Number(BigInt(`0x${b.subarray(32, 64).toString("hex")}`));
  return b.subarray(64, 64 + len).toString("utf8");
}

export async function erc20Info(chain: string, token: string, environment = "mainnet"): Promise<{ symbol: string; decimals: number } | null> {
  try {
    const code = await erpc<string>(chain, "eth_getCode", [token, "latest"], environment);
    if (!code || code === "0x") return null;
    const [dec, sym] = await Promise.all([call(chain, token, "0x313ce567", environment), call(chain, token, "0x95d89b41", environment)]);
    const decimals = Number(hexToBig(dec));
    if (!Number.isFinite(decimals) || decimals > 36) return null;
    return { symbol: decodeString(sym) || "TOKEN", decimals };
  } catch {
    return null;
  }
}

export async function erc20Balance(chain: string, token: string, holder: string, environment = "mainnet"): Promise<bigint> {
  return hexToBig(await call(chain, token, `0x70a08231${pad32(holder).slice(2)}`, environment));
}

/** Inspect a Safe smart account: owners + threshold (null if not a Safe). */
export async function inspectSafe(chain: string, address: string, environment = "mainnet"): Promise<{ owners: string[]; threshold: number; version: string | null } | null> {
  try {
    const [ownersHex, thrHex] = await Promise.all([call(chain, address, "0xa0e67e2b", environment), call(chain, address, "0xe75235b8", environment)]);
    const b = Buffer.from(ownersHex.replace(/^0x/, ""), "hex");
    const len = Number(BigInt(`0x${b.subarray(32, 64).toString("hex")}`));
    if (!len || len > 50) return null;
    const owners = Array.from({ length: len }, (_, i) => `0x${b.subarray(64 + i * 32 + 12, 64 + (i + 1) * 32).toString("hex")}`);
    let version: string | null = null;
    try { version = decodeString(await call(chain, address, "0xffa1ad74", environment)) || null; } catch { /* optional */ }
    return { owners, threshold: Number(hexToBig(thrHex)), version };
  } catch {
    return null;
  }
}

export const encodeErc20Transfer = (to: string, amount: bigint) => `0xa9059cbb${pad32(to).slice(2)}${amount.toString(16).padStart(64, "0")}`;
export const encodeErc20Approve = (spender: string, amount: bigint) => `0x095ea7b3${pad32(spender).slice(2)}${amount.toString(16).padStart(64, "0")}`;

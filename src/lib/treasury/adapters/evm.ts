import "server-only";
import { verifyEvm } from "../../server/auth";
import { erc20Balance, erc20Info, erpc, hexToBig, inspectSafe, isEvmAddress } from "../evm";
import { getChain } from "../../chains";
import { KNOWN_TOKENS, knownToken, NATIVE_EVM, sameToken } from "../tokens";
import type { Balance, Inspection, TreasuryAdapter } from "./types";

export const evmAdapter: TreasuryAdapter = {
  chainType: "evm",
  kinds: ["wallet", "safe"],
  validAddress: isEvmAddress,

  async inspect({ chain, environment, kind, address }): Promise<Inspection> {
    const warnings: string[] = [], errors: string[] = [];
    if (!isEvmAddress(address)) return { ok: false, receivingAddress: address, facts: {}, warnings, errors: ["Not a valid EVM address."] };
    const code = await erpc<string>(chain, "eth_getCode", [address, "latest"], environment);
    const isContract = !!code && code !== "0x";
    const facts: Record<string, unknown> = { isContract };
    if (kind === "wallet") {
      if (isContract) errors.push("This address is a smart contract. Choose “Safe smart account” for multisig treasuries.");
      return { ok: errors.length === 0, receivingAddress: address, facts, warnings, errors };
    }
    if (!isContract) return { ok: false, receivingAddress: address, facts, warnings, errors: [`No contract deployed at this address on ${getChain(chain)?.name}. Deploy the Safe on this network first.`] };
    const safe = await inspectSafe(chain, address, environment);
    if (!safe) return { ok: false, receivingAddress: address, facts, warnings, errors: ["Contract does not respond like a Safe (getOwners/getThreshold)."] };
    if (safe.threshold < 2) warnings.push("Safe threshold is 1 — a single owner can move funds.");
    return { ok: true, receivingAddress: address, facts: { ...facts, ...safe }, warnings, errors };
  },

  async verifyOwnership(t, signer, message, signature) {
    if (!verifyEvm(message, signature, signer)) return { ok: false, method: "personal_sign", detail: "Signature does not verify." };
    if (!message.toLowerCase().includes(t.address.toLowerCase())) return { ok: false, method: "personal_sign", detail: "Message does not reference this treasury." };
    if (t.kind === "wallet") {
      return signer.toLowerCase() === t.address.toLowerCase()
        ? { ok: true, method: "wallet-signature", detail: "Signed by the treasury wallet itself." }
        : { ok: false, method: "wallet-signature", detail: "Signer is not the treasury address." };
    }
    const safe = await inspectSafe(t.chain, t.address, t.environment);
    if (!safe) return { ok: false, method: "safe-owner", detail: "Could not read Safe owners." };
    return safe.owners.some((o) => o.toLowerCase() === signer.toLowerCase())
      ? { ok: true, method: "safe-owner", detail: `Signed by Safe owner; threshold ${safe.threshold}/${safe.owners.length}.` }
      : { ok: false, method: "safe-owner", detail: "Signer is not an owner of this Safe." };
  },

  async tokenInfo(chain, token, environment) {
    if (sameToken(token, NATIVE_EVM)) return null; // native fees can't be verified from Transfer logs
    const info = await erc20Info(chain, token, environment);
    if (!info) return null;
    const known = knownToken(chain, token);
    return { symbol: known?.symbol ?? info.symbol, decimals: info.decimals };
  },

  feeAccount(t) {
    return t.address;
  },

  async checkFeeAccounts(t) {
    return (t.feeConfig?.tokens ?? []).map((tok) => ({ token: tok.token, account: t.address, initialized: true, detail: "EVM addresses can receive ERC-20 transfers without setup" }));
  },

  async balances(t) {
    const c = getChain(t.chain)!;
    const out: Balance[] = [];
    const wei = await erpc<string>(t.chain, "eth_getBalance", [t.address, "latest"], t.environment);
    out.push({ token: NATIVE_EVM, symbol: c.nativeSymbol, decimals: 18, amountRaw: hexToBig(wei).toString(), account: t.address, native: true });
    const tokens = [...(KNOWN_TOKENS[t.chain] ?? []), ...(t.feeConfig?.tokens ?? [])];
    const seen = new Set<string>();
    for (const tok of tokens) {
      const k = tok.token.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      try {
        const bal = await erc20Balance(t.chain, tok.token, t.address, t.environment);
        if (bal > BigInt(0) || t.feeConfig?.tokens.some((x) => sameToken(x.token, tok.token))) out.push({ token: tok.token, symbol: tok.symbol, decimals: tok.decimals, amountRaw: bal.toString(), account: t.address });
      } catch { /* skip */ }
    }
    return out;
  },
};

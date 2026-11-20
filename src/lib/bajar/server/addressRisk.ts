import "server-only";
import { cached } from "../../server/cache";
import { fetchUpstream } from "../../server/http";
import { srpc } from "../../treasury/solana";
import { erpc } from "../../treasury/evm";
import { getChain } from "../../chains";
import { isMainnetBtcAddress } from "./bitcoin";

export interface RiskFlag { severity: "info" | "warn" | "danger"; code: string; message: string }
export interface AddressRisk { network: string; address: string; valid: boolean; flags: RiskFlag[]; sources: string[]; checkedAt: number }

const GOPLUS_CHAIN: Record<string, string> = { ethereum: "1", bsc: "56", polygon: "137", arbitrum: "42161", base: "8453", optimism: "10", avalanche: "43114" };
const GOPLUS_LABELS: Record<string, string> = {
  phishing_activities: "phishing", stealing_attack: "theft / drainer", sanctioned: "sanctioned (OFAC)", cybercrime: "cybercrime", money_laundering: "money laundering",
  financial_crime: "financial crime", blackmail_activities: "blackmail", darkweb_transactions: "darkweb transactions", fake_kyc: "fake KYC", mixer: "mixer", honeypot_related_address: "honeypot",
  malicious_mining_activities: "malicious mining", fake_token: "fake token", blacklist_doubt: "blacklisted",
};
const SYSTEM_PROGRAMS = new Set(["11111111111111111111111111111111", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"]);

/**
 * Server-side recipient screening: known-malicious lists (GoPlus, EVM),
 * contract / token / program detection on-chain, and format validation.
 * Advisory only — the wallet shows the result and the user decides.
 */
export function addressRisk(network: string, address: string): Promise<AddressRisk> {
  return cached(`risk:${network}:${address.toLowerCase()}`, "GoPlus + on-chain", { ttlMs: 10 * 60_000, staleMs: 60 * 60_000 }, async () => {
    const flags: RiskFlag[] = [];
    const sources: string[] = [];
    let valid = true;
    if (network === "bitcoin") {
      valid = isMainnetBtcAddress(address);
      if (!valid) flags.push({ severity: "danger", code: "invalid", message: "Not a valid mainnet Bitcoin address." });
      else if (/^bc1p/.test(address)) flags.push({ severity: "info", code: "taproot", message: "Taproot address — supported, but some exchanges can't receive to it." });
    } else if (network === "solana") {
      valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
      if (!valid) flags.push({ severity: "danger", code: "invalid", message: "Not a valid Solana address." });
      else {
        sources.push("Solana RPC");
        if (SYSTEM_PROGRAMS.has(address)) flags.push({ severity: "danger", code: "program", message: "This is a system program address. Funds sent here are lost." });
        const info = await srpc<{ value: { owner: string; executable: boolean; data: [string, string] } | null }>("getAccountInfo", [address, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]).catch(() => null);
        if (info?.value?.executable) flags.push({ severity: "danger", code: "program", message: "This is an executable program, not a wallet." });
        else if (info?.value && (info.value.owner === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" || info.value.owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")) {
          flags.push({ severity: "warn", code: "token_account", message: "This is a token account or mint, not a wallet address. Make sure the recipient asked for this exact address." });
        } else if (!info?.value) flags.push({ severity: "info", code: "new_account", message: "This address has never been used on Solana." });
      }
    } else {
      const c = getChain(network);
      valid = !!c && c.type === "evm" && /^0x[0-9a-fA-F]{40}$/.test(address);
      if (!valid) flags.push({ severity: "danger", code: "invalid", message: "Not a valid EVM address." });
      else {
        if (/^0x0{40}$/i.test(address) || /^0x0{36}dead$/i.test(address)) flags.push({ severity: "danger", code: "burn", message: "This is a burn address. Funds sent here are destroyed." });
        const [code, gp] = await Promise.all([
          erpc<string>(network, "eth_getCode", [address, "latest"]).catch(() => null),
          GOPLUS_CHAIN[network] ? fetchUpstream<{ code: number; result: Record<string, string> | null }>(`https://api.gopluslabs.io/api/v1/address_security/${address}?chain_id=${GOPLUS_CHAIN[network]}`, { retries: 0, timeoutMs: 6000 }).catch(() => null) : Promise.resolve(null),
        ]);
        sources.push(`${c!.name} RPC`);
        if (code && code !== "0x") flags.push({ severity: "warn", code: "contract", message: "This is a smart contract, not a personal wallet. Only send if you know it accepts this asset (many contracts don't)." });
        if (gp?.code === 1 && gp.result) {
          sources.push(`GoPlus${gp.result.data_source ? ` (${gp.result.data_source})` : ""}`);
          const hits = Object.entries(GOPLUS_LABELS).filter(([k]) => gp.result![k] === "1").map(([, v]) => v);
          if (hits.length) flags.push({ severity: "danger", code: "malicious", message: `Reported as malicious: ${hits.join(", ")}. Do not send funds.` });
        }
      }
    }
    return { network, address, valid, flags, sources, checkedAt: Date.now() };
  }).then((e) => e.data);
}

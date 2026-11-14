import type { ChainConfig, FetchJson, RiskLevel, RiskSignal, RiskSummary } from "../types.ts";
import { num } from "./geckoterminal.ts";

/** GoPlus token security (honeypot, permissions, taxes, holders, LP locks). No key needed for low volume. */
export const GP_SOURCE = "GoPlus Security";

/* eslint-disable @typescript-eslint/no-explicit-any */
const yes = (v: unknown) => v === "1" || v === 1 || v === true;
const flag = (v: unknown): boolean | null => (v === undefined || v === null || v === "" ? null : yes(v));
const status = (o: any): boolean | null => (o && o.status !== undefined ? yes(o.status) : null);
const pct = (v: unknown) => { const n = num(v); return n === null ? null : n <= 1 ? n * 100 : n; };
const DEAD = /^(0x0{40}|0x0{36}dead|0x000000000000000000000000000000000000dead)?$/i;

function level(signals: RiskSignal[], known: boolean): RiskLevel {
  if (!known) return "unknown";
  if (signals.some((s) => s.level === "high")) return "high";
  if (signals.some((s) => s.level === "medium")) return "medium";
  return "low";
}

/** Raw GoPlus entry → unified risk summary. Pure. `entry` null = provider has no data (level "unknown"). */
export function parseRisk(chain: ChainConfig, address: string, entry: any | null): RiskSummary {
  const s: RiskSignal[] = [];
  const add = (key: string, lvl: RiskSignal["level"], label: string, detail: string) => s.push({ key, level: lvl, label, detail });
  if (!entry) {
    return { chain: chain.id, address, level: "unknown", honeypot: null, buyTaxPct: null, sellTaxPct: null,
      permissions: { mintable: null, freezable: null, ownerChangeBalance: null, proxy: null, renounced: null },
      holders: { count: null, top10Pct: null }, lockedLiquidityPct: null, signals: [], source: GP_SOURCE };
  }
  const holders: any[] = Array.isArray(entry.holders) ? entry.holders : [];
  const top10 = holders.length ? holders.slice(0, 10).reduce((t, h) => t + (pct(h.percent) ?? 0), 0) : null;
  if (top10 !== null && top10 > 50) add("concentration", top10 > 80 ? "high" : "medium", "Holder concentration", `Top 10 holders own ${top10.toFixed(1)}%`);

  if (chain.kind === "solana") {
    const mint = status(entry.mintable), freeze = status(entry.freezable), bal = status(entry.balance_mutable_authority);
    if (mint) add("mintable", "high", "Mint authority active", "Supply can be increased");
    if (freeze) add("freezable", "high", "Freeze authority active", "Token accounts can be frozen");
    if (bal) add("balance_mutable", "high", "Balance authority", "Balances can be changed");
    if (entry.transfer_fee && Object.keys(entry.transfer_fee).length) add("transfer_fee", "medium", "Transfer fee", "A fee is charged on transfers");
    return {
      chain: chain.id, address, level: level(s, true), honeypot: null, buyTaxPct: null, sellTaxPct: null,
      permissions: { mintable: mint, freezable: freeze, ownerChangeBalance: bal, proxy: null, renounced: mint === false && freeze === false ? true : mint || freeze ? false : null },
      holders: { count: num(entry.holder_count), top10Pct: top10 }, lockedLiquidityPct: null, signals: s, source: GP_SOURCE,
    };
  }

  const honeypot = flag(entry.is_honeypot);
  const buyTax = pct(entry.buy_tax), sellTax = pct(entry.sell_tax);
  if (honeypot) add("honeypot", "high", "Honeypot", "Tokens may not be sellable");
  if (yes(entry.cannot_sell_all)) add("cannot_sell", "high", "Sell restriction", "Holders cannot sell all tokens");
  if (yes(entry.owner_change_balance)) add("balance_change", "high", "Owner can change balances", "The owner can modify holder balances");
  if (yes(entry.hidden_owner)) add("hidden_owner", "high", "Hidden owner", "A hidden owner was detected");
  if (yes(entry.is_mintable)) add("mintable", "medium", "Mintable", "The owner can mint new tokens");
  if (yes(entry.is_proxy)) add("proxy", "medium", "Upgradeable", "Contract logic can be changed");
  if (yes(entry.transfer_pausable)) add("pausable", "medium", "Pausable", "Transfers can be paused");
  if (yes(entry.is_blacklisted)) add("blacklist", "medium", "Blacklist", "Addresses can be blacklisted");
  if (entry.is_open_source === "0") add("unverified", "medium", "Unverified source", "Contract source is not verified");
  if (buyTax !== null && buyTax > 10) add("buy_tax", buyTax > 30 ? "high" : "medium", "High buy tax", `${buyTax.toFixed(1)}%`);
  if (sellTax !== null && sellTax > 10) add("sell_tax", sellTax > 30 ? "high" : "medium", "High sell tax", `${sellTax.toFixed(1)}%`);
  const lp: any[] = Array.isArray(entry.lp_holders) ? entry.lp_holders : [];
  const locked = lp.length ? lp.filter((h) => yes(h.is_locked)).reduce((t, h) => t + (pct(h.percent) ?? 0), 0) : null;
  if (locked !== null && locked < 50) add("lp_unlocked", "medium", "Liquidity not locked", `Only ${locked.toFixed(1)}% of liquidity is locked`);
  const owner = typeof entry.owner_address === "string" ? entry.owner_address : null;
  return {
    chain: chain.id, address, level: level(s, true), honeypot, buyTaxPct: buyTax, sellTaxPct: sellTax,
    permissions: { mintable: flag(entry.is_mintable), freezable: null, ownerChangeBalance: flag(entry.owner_change_balance), proxy: flag(entry.is_proxy), renounced: owner === null ? null : DEAD.test(owner) },
    holders: { count: num(entry.holder_count), top10Pct: top10 }, lockedLiquidityPct: locked, signals: s, source: GP_SOURCE,
  };
}

export function goPlus(fetchJson: FetchJson) {
  return {
    risk: async (chain: ChainConfig, address: string) => {
      const url = chain.kind === "solana"
        ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`
        : `https://api.gopluslabs.io/api/v1/token_security/${chain.providers.goplus}?contract_addresses=${address.toLowerCase()}`;
      const raw = await fetchJson<{ result?: Record<string, any> | null }>(url);
      const entry = raw?.result ? Object.values(raw.result)[0] ?? null : null;
      return parseRisk(chain, address, entry);
    },
  };
}

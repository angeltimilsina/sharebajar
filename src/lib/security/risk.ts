/**
 * Pure risk scoring from GoPlus token-security data. Kept free of I/O so it
 * can be unit tested. Scores are heuristics, not guarantees — the UI says so.
 */
export type Severity = "high" | "medium" | "low" | "info";

export interface RiskFlag {
  key: string;
  label: string;
  severity: Severity;
  detail?: string;
  /** true = the check passed (shown green) */
  ok: boolean;
}

export interface Holder { address: string; percent: number; isContract: boolean; isLocked: boolean; tag: string }

export interface RiskReport {
  /** 0 (safest) – 100 (riskiest) */
  score: number;
  level: "low" | "medium" | "high" | "unknown";
  flags: RiskFlag[];
  holders: Holder[];
  holderCount: number | null;
  top10Pct: number | null;
  buyTax: number | null;
  sellTax: number | null;
  openSource: boolean | null;
  trusted: boolean;
  source: "GoPlus";
}

const WEIGHT: Record<Severity, number> = { high: 30, medium: 12, low: 4, info: 0 };
const yes = (v: unknown) => v === "1" || v === 1 || v === true;
const pct = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n * 100 : 0;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function finish(flags: RiskFlag[], holders: Holder[], extra: Partial<RiskReport>): RiskReport {
  const raw = flags.filter((f) => !f.ok).reduce((s, f) => s + WEIGHT[f.severity], 0);
  const score = Math.min(100, raw);
  const top10Pct = holders.length ? holders.slice(0, 10).reduce((s, h) => s + h.percent, 0) : null;
  return {
    score,
    level: flags.length === 0 ? "unknown" : score >= 45 ? "high" : score >= 15 ? "medium" : "low",
    flags: flags.sort((a, b) => Number(a.ok) - Number(b.ok) || WEIGHT[b.severity] - WEIGHT[a.severity]),
    holders,
    top10Pct,
    holderCount: null,
    buyTax: null,
    sellTax: null,
    openSource: null,
    trusted: false,
    source: "GoPlus",
    ...extra,
  };
}

function concentrationFlag(holders: Holder[]): RiskFlag | null {
  // Ignore burn addresses and locked/LP contracts when judging concentration.
  const relevant = holders.filter((h) => !h.isLocked && !/^0x0{36}dead$|^0x0{40}$/i.test(h.address));
  if (!relevant.length) return null;
  const top10 = relevant.slice(0, 10).reduce((s, h) => s + h.percent, 0);
  const sev: Severity = top10 > 60 ? "high" : top10 > 35 ? "medium" : "low";
  return { key: "concentration", label: "Top-10 holder concentration", severity: sev, detail: `${top10.toFixed(1)}% of supply`, ok: top10 <= 35 };
}

type Add = (key: string, label: string, bad: boolean, severity: Severity, badDetail?: string, okDetail?: string) => void;
const adder = (f: RiskFlag[]): Add => (key, label, bad, severity, badDetail, okDetail) =>
  f.push({ key, label, severity, ok: !bad, detail: bad ? badDetail : okDetail });

export function scoreEvm(r: any): RiskReport {
  const f: RiskFlag[] = [];
  const add = adder(f);
  add("honeypot", "Honeypot check", yes(r.is_honeypot), "high", "Tokens may not be sellable", "Sellable in simulation");
  add("cannot_sell", "Sell restrictions", yes(r.cannot_sell_all), "high", "Holders cannot sell all tokens", "None detected");
  add("cannot_buy", "Buy restrictions", yes(r.cannot_buy), "high", "Buying is disabled", "None detected");
  add("open_source", "Contract source", r.is_open_source === "0", "medium", "Not verified", "Verified");
  add("proxy", "Upgradeable proxy", yes(r.is_proxy), "medium", "Logic can be changed by owner", "No");
  add("mintable", "Mint function", yes(r.is_mintable), "medium", "Owner can mint new tokens", "None");
  add("take_back", "Reclaim ownership", yes(r.can_take_back_ownership), "high", "Ownership can be reclaimed", "Not possible");
  add("hidden_owner", "Hidden owner", yes(r.hidden_owner), "high", "Detected", "None");
  add("balance_change", "Balance modification", yes(r.owner_change_balance), "high", "Owner can modify balances", "Not possible");
  add("selfdestruct", "Self-destruct", yes(r.selfdestruct), "high", "Present", "None");
  add("pausable", "Transfer pause", yes(r.transfer_pausable), "medium", "Transfers can be paused", "Not pausable");
  add("blacklist", "Blacklist", yes(r.is_blacklisted), "medium", "Addresses can be blacklisted", "None");
  add("slippage_mod", "Tax modification", yes(r.slippage_modifiable), "medium", "Owner can change taxes", "Fixed");
  add("cooldown", "Trading cooldown", yes(r.trading_cooldown), "low", "Enabled", "None");
  add("external_call", "External calls", yes(r.external_call), "low", "Contract makes external calls", "None");

  const buyTax = r.buy_tax === "" || r.buy_tax === undefined ? null : pct(r.buy_tax);
  const sellTax = r.sell_tax === "" || r.sell_tax === undefined ? null : pct(r.sell_tax);
  if (buyTax !== null) add("buy_tax", "Buy tax", buyTax > 10, buyTax > 30 ? "high" : "medium", `${buyTax.toFixed(1)}%`, `${buyTax.toFixed(1)}%`);
  if (sellTax !== null) add("sell_tax", "Sell tax", sellTax > 10, sellTax > 30 ? "high" : "medium", `${sellTax.toFixed(1)}%`, `${sellTax.toFixed(1)}%`);

  const lpLocked = Array.isArray(r.lp_holders) ? r.lp_holders.filter((h: any) => h.is_locked === 1).reduce((s: number, h: any) => s + pct(h.percent), 0) : null;
  if (lpLocked !== null && r.lp_holders.length) add("lp_locked", "Liquidity lock", lpLocked < 50, "medium", `Only ${lpLocked.toFixed(1)}% of LP locked`, `${lpLocked.toFixed(1)}% of LP locked`);

  const holders: Holder[] = (r.holders ?? []).map((h: any) => ({
    address: h.address, percent: pct(h.percent), isContract: h.is_contract === 1, isLocked: h.is_locked === 1, tag: h.tag ?? "",
  }));
  const c = concentrationFlag(holders);
  if (c) f.push(c);

  return finish(f, holders, {
    holderCount: Number(r.holder_count) || null, buyTax, sellTax,
    openSource: r.is_open_source === undefined ? null : r.is_open_source === "1",
    trusted: yes(r.trust_list),
  });
}

export function scoreSolana(r: any): RiskReport {
  const f: RiskFlag[] = [];
  const st = (o: any) => yes(o?.status);
  const add = adder(f);
  add("mintable", "Mint authority", st(r.mintable), "high", "Active — supply can be inflated", "Renounced");
  add("freezable", "Freeze authority", st(r.freezable), "high", "Active — accounts can be frozen", "Renounced");
  add("balance_mutable", "Balance authority", st(r.balance_mutable_authority), "high", "Balances can be changed", "None");
  add("closable", "Closable token accounts", st(r.closable), "medium", "Authority can close accounts", "No");
  add("non_transferable", "Transferability", yes(r.non_transferable), "high", "Non-transferable", "Transferable");
  add("transfer_hook", "Transfer hook", Array.isArray(r.transfer_hook) && r.transfer_hook.length > 0, "medium", "Custom logic runs on transfers", "None");
  add("transfer_fee", "Transfer fee", r.transfer_fee && Object.keys(r.transfer_fee).length > 0, "medium", "Fee charged on transfers", "None");
  add("metadata_mutable", "Metadata", st(r.metadata_mutable), "low", "Mutable by update authority", "Immutable");
  add("default_frozen", "Default account state", r.default_account_state === "2", "high", "New accounts start frozen", "Normal");

  const holders: Holder[] = (r.holders ?? []).map((h: any) => ({
    address: h.account ?? h.token_account, percent: pct(h.percent), isContract: false, isLocked: h.is_locked === 1, tag: h.tag ?? "",
  }));
  const c = concentrationFlag(holders);
  if (c) f.push(c);

  return finish(f, holders, { holderCount: Number(r.holder_count) || null, trusted: yes(r.trusted_token) });
}

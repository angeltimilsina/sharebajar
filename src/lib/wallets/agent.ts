"use client";
import type { WalletBalance } from "@/hooks/useWallets";

/**
 * Portfolio summary handed to the investment agent: assets, values,
 * allocation and 24h moves — never addresses. Symbols are sanitised because
 * token metadata is attacker-controlled.
 */
export interface AgentPortfolio {
  totalUsd: number;
  walletCount: number;
  chains: string[];
  holdings: { symbol: string; network: string; valueUsd: number; pct: number; change24h: number | null }[];
}
const KEY = "bajar.agent.portfolio";
const clean = (s: string) => s.replace(/[^A-Za-z0-9.$_-]/g, "").slice(0, 16) || "?";

export function buildAgentPortfolio(balances: WalletBalance[]): AgentPortfolio {
  const merged = new Map<string, { symbol: string; network: string; valueUsd: number; change24h: number | null }>();
  for (const b of balances) for (const h of b.holdings) {
    if (!h.usdValue || h.usdValue < 1) continue;
    const k = `${clean(h.symbol)}:${h.network}`;
    const cur = merged.get(k) ?? { symbol: clean(h.symbol), network: h.network, valueUsd: 0, change24h: h.change24h ?? null };
    cur.valueUsd += h.usdValue;
    merged.set(k, cur);
  }
  const total = [...merged.values()].reduce((s, h) => s + h.valueUsd, 0);
  const holdings = [...merged.values()].sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 40)
    .map((h) => ({ ...h, valueUsd: Math.round(h.valueUsd * 100) / 100, pct: total ? Math.round((h.valueUsd / total) * 1000) / 10 : 0 }));
  return { totalUsd: Math.round(total * 100) / 100, walletCount: balances.length, chains: [...new Set(balances.map((b) => b.wallet.chain))], holdings };
}

export function stashAgentPortfolio(p: AgentPortfolio) { try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* blocked */ } }
export function readAgentPortfolio(): AgentPortfolio | null { try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { return null; } }

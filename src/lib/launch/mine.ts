"use client";
import { activities } from "@/lib/activity";
import { bajar } from "@/lib/bajar/session";
import { customTokens, saveCustomTokens } from "@/components/bajar/customTokens";

/** Launches recorded in this browser's activity log ("Launched SYMBOL (Name)", with the token page link). */
export function localLaunches(addresses: string[]): { mint: string; chain: string; symbol: string; name: string }[] {
  const mine = new Set(addresses.map((a) => a.toLowerCase()));
  return activities().flatMap((a) => {
    const m = /^Launched (\S+) \((.+?)\)/.exec(a.summary);
    const h = /^\/token\/([a-z]+)\/([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})/.exec(a.assetHref ?? "");
    if (!m || !h || a.status === "failed" || (a.wallet && !mine.has(a.wallet.toLowerCase()))) return [];
    return [{ mint: h[2], chain: h[1], symbol: m[1], name: m[2] }];
  });
}

/** Show a Solana token you launched from Bajar Wallet in the wallet's holdings (as a tracked token). */
export function trackInBajarWallet(t: { mint: string; chain: string; symbol: string; decimals?: number; creator?: string }) {
  const a = bajar.accounts();
  if (!a || t.chain !== "solana" || (t.creator && t.creator !== a.solana.address)) return;
  const list = customTokens();
  if (list.some((x) => x.network === "solana" && x.token === t.mint)) return;
  saveCustomTokens([...list, { network: "solana", token: t.mint, symbol: t.symbol.slice(0, 10), decimals: t.decimals ?? 6 }]);
}

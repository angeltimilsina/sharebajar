"use client";
import { useState } from "react";
import { SecurityPanel } from "./SecurityPanel";
import { CustomTokens } from "./PortfolioPanel";
import { customTokens, saveCustomTokens, type CustomToken } from "./customTokens";

/** Everything you set up once: security, backups, sign-in, and which extra tokens to track. */
export function WalletSettings() {
  const [list, setList] = useState<CustomToken[]>(() => customTokens());
  return (
    <div className="space-y-4">
      <SecurityPanel />
      <CustomTokens list={list} onChange={(l) => { saveCustomTokens(l); setList(l); }} />
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Info } from "lucide-react";
import { SwapPanel } from "../trade/SwapPanel";
import { EvmSwapPanel, type EvmTok } from "../trade/EvmSwapPanel";
import { Notice } from "../ui/primitives";
import { NATIVE_EVM, ZEROX_CHAINS } from "@/lib/treasury/tokens";

/** What can be executed for an asset, resolved on the server page. */
export interface ExecAsset {
  symbol: string;
  name: string;
  /** Network the on-chain token lives on ("solana", an EVM slug) — null if not tradable on-chain here. */
  chain: string | null;
  token: string | null;
  /** Shown when `chain` is null. */
  unavailableReason?: string;
  /** Link back to this asset (stored with activity so Portfolio can return here). */
  href: string;
}

export type ExecMode = "trade" | "swap";

/**
 * Trade and Swap as two execution modes of the same asset.
 * Trade = buy/sell this asset against USDC (market order).
 * Swap  = any token → this asset (destination prefilled).
 */
export function AssetExecution({ asset, mode, onMode, side: sideProp, onSide }: {
  asset: ExecAsset; mode: ExecMode; onMode: (m: ExecMode) => void; side?: "buy" | "sell"; onSide?: (s: "buy" | "sell") => void;
}) {
  const [sideState, setSideState] = useState<"buy" | "sell">(sideProp ?? "buy");
  const side = sideProp ?? sideState;
  const setSide = (s: "buy" | "sell") => { setSideState(s); onSide?.(s); };
  const evm = !!asset.chain && asset.chain in ZEROX_CHAINS;
  const [evmTok, setEvmTok] = useState<EvmTok | null>(null);
  const [evmErr, setEvmErr] = useState<string | null>(null);

  // EVM execution needs the token's decimals (verified on-chain).
  useEffect(() => {
    if (!evm || !asset.token) return;
    if (asset.token.toLowerCase() === NATIVE_EVM.toLowerCase()) { setEvmTok({ token: NATIVE_EVM, symbol: asset.symbol, decimals: 18 }); return; }
    let alive = true;
    fetch(`/api/wallet/token?network=${asset.chain}&token=${asset.token}`).then((r) => r.json()).then((b) => {
      if (!alive) return;
      if (b.decimals === undefined) throw new Error(b.error ?? "Token not found");
      setEvmTok({ token: asset.token!, symbol: b.symbol ?? asset.symbol, decimals: b.decimals });
    }).catch((e) => alive && setEvmErr(String(e.message ?? e)));
    return () => { alive = false; };
  }, [evm, asset.chain, asset.token, asset.symbol]);

  return (
    <div className="panel p-4" data-testid="asset-execution">
      <div className="flex items-center gap-2 mb-3" role="tablist" aria-label="Execution mode">
        {(["trade", "swap"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => onMode(m)}
            className={clsx("flex-1 h-9 rounded-full text-sm font-medium transition-colors", mode === m ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}>
            {m === "trade" ? "Trade" : "Swap"}
          </button>
        ))}
      </div>

      {mode === "trade" && (
        <div className="mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-1.5 rounded-full bg-surface-2 p-1">
            {(["buy", "sell"] as const).map((s) => (
              <button key={s} onClick={() => setSide(s)} aria-pressed={side === s} data-testid={`side-${s}`}
                className={clsx("h-8 rounded-full text-sm font-medium transition-colors", side === s ? (s === "buy" ? "bg-up text-white" : "bg-down text-white") : "text-muted hover:text-fg")}>
                {s === "buy" ? "Buy" : "Sell"} {asset.symbol}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted">Order type</span>
            <span className="rounded-full bg-surface-3 px-2.5 py-1 font-medium">Market</span>
            <span className="rounded-full border border-line px-2.5 py-1 text-faint" title="Limit orders aren't available yet">Limit · soon</span>
          </div>
        </div>
      )}

      {!asset.chain || !asset.token ? (
        <Notice tone="info" title="On-chain execution isn't available for this asset">
          {asset.unavailableReason ?? "There's no verified on-chain market for this asset on a supported network."}
          {asset.symbol === "BTC" && <> Native BTC swaps are available in <Link className="underline" href="/wallet">Bajar Wallet → Swap</Link>.</>}
        </Notice>
      ) : asset.chain === "solana" ? (
        <SwapPanel key={`${mode}-${side}`} defaultOutput={asset.token} side={mode === "trade" ? side : "buy"} variant={mode} lockAsset embedded assetHref={asset.href} />
      ) : evm ? (
        evmTok ? <EvmSwapPanel key={`${mode}-${side}`} chain={asset.chain} asset={evmTok} variant={mode} side={mode === "trade" ? side : "buy"} lockAsset embedded assetHref={asset.href} />
          : evmErr ? <Notice tone="down">{evmErr}</Notice> : <div className="h-40 skeleton" />
      ) : (
        <Notice tone="info">Swaps on this network aren&apos;t supported yet.</Notice>
      )}

      <p className="mt-3 text-[11px] text-faint flex gap-1.5"><Info size={12} className="shrink-0 mt-0.5" />Executed on-chain from your own wallet. You&apos;ll see the rate, network fee, platform fee, price impact, minimum received and route before you confirm.</p>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { Search, BadgeCheck, Loader2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { TokenIcon } from "../ui/TokenIcon";
import { Badge } from "../ui/primitives";
import { formatUsd, shortAddress } from "@/lib/format";

export interface SwapToken { address: string; symbol: string; name: string; decimals: number; icon: string | null; verified?: boolean; liquidity?: number | null }

export const COMMON: SwapToken[] = [
  { address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9, icon: null, verified: true },
  { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, icon: null, verified: true },
  { address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD", decimals: 6, icon: null, verified: true },
  { address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6, icon: null, verified: true },
  { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "Bonk", name: "Bonk", decimals: 5, icon: null, verified: true },
];

export function TokenPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: SwapToken) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SwapToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setItems([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/swap/tokens?q=${encodeURIComponent(q.trim())}`).then((r) => r.json()).then((b) => {
        if (b.error) throw new Error(b.error);
        setError(null);
        setItems((b.data as { address: string; symbol: string; name: string; decimals: number; icon: string | null; verified: boolean; liquidity: number | null }[]).map((x) => ({ ...x })));
      }).catch((e) => setError(String(e.message))).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);
  const list = q.trim().length >= 2 ? items : COMMON;
  return (
    <Modal open={open} onClose={onClose} title="Select a token">
      <div className="px-5 pb-5">
        <div className="flex items-center gap-2 h-11 rounded-xl border border-line bg-surface-2 px-3">
          <Search size={15} className="text-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, symbol or mint address" className="bg-transparent outline-none flex-1 text-sm" />
          {loading && <Loader2 size={14} className="animate-spin text-muted" />}
        </div>
        {error && <div className="text-xs text-down mt-2">{error}</div>}
        <ul className="mt-3 max-h-[50vh] overflow-y-auto scroll-thin -mx-2">
          {list.map((t) => (
            <li key={t.address}>
              <button onClick={() => { onPick(t); onClose(); }} className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-3 text-left">
                <TokenIcon src={t.icon} symbol={t.symbol} size={30} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5 font-semibold text-sm">{t.symbol}{t.verified ? <BadgeCheck size={13} className="text-up" /> : <Badge tone="warn">Unverified</Badge>}</span>
                  <span className="block text-xs text-muted truncate">{t.name} · <span className="num">{shortAddress(t.address)}</span></span>
                </span>
                {t.liquidity ? <span className="text-xs text-muted num">Liq {formatUsd(t.liquidity)}</span> : null}
              </button>
            </li>
          ))}
          {!list.length && !loading && <li className="text-xs text-muted text-center py-6">No tokens found.</li>}
        </ul>
      </div>
    </Modal>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, ArrowRight } from "lucide-react";
import { Modal } from "../ui/Modal";
import { TokenIcon } from "../ui/TokenIcon";
import { ChainLabel } from "../ui/ChainIcon";
import { Badge } from "../ui/primitives";
import { formatPrice, formatUsd, shortAddress } from "@/lib/format";
import type { SearchResult } from "@/lib/types";

type Item = { key: string; href: string; render: React.ReactNode };

/** Button that opens the (single, global) search dialog. */
export function SearchTrigger({ className }: { className?: string }) {
  return (
    <button onClick={() => window.dispatchEvent(new Event("sb-open-search"))} className={className} aria-label="Search tokens">
      <Search size={16} className="text-muted shrink-0" />
      <span className="flex-1 text-left text-sm text-muted truncate">Search token, contract, or wallet…</span>
      <kbd className="hidden md:inline text-[10px] font-semibold text-muted bg-surface-3 border border-line rounded px-1.5 py-0.5">⌘K</kbd>
    </button>
  );
}

/** Mounted once in the header; opens via ⌘K, "/" or the sb-open-search event. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    const onOpen = () => setOpen(true);
    window.addEventListener("sb-open-search", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("sb-open-search", onOpen); };
  }, []);
  return <CommandSearch open={open} onClose={() => setOpen(false)} />;
}

function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 20); } else { setQ(""); setRes(null); } }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json()).then((d: SearchResult) => { setRes(d); setActive(0); })
        .catch(() => {}).finally(() => setLoading(false));
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const items: Item[] = [];
  res?.coins.forEach((c) => items.push({
    key: `c:${c.id}`, href: `/coin/${c.id}`,
    render: (<><TokenIcon src={c.thumb} symbol={c.symbol} size={26} /><span className="flex-1 min-w-0"><span className="font-medium">{c.name}</span> <span className="text-muted text-xs">{c.symbol}</span></span>{c.rank && <Badge>#{c.rank}</Badge>}</>),
  }));
  res?.pairs.forEach((p) => items.push({
    key: `p:${p.chain}:${p.base.address}`, href: `/token/${p.chain}/${p.base.address}${p.pairAddress ? `?pair=${p.pairAddress}` : ""}`,
    render: (<><TokenIcon src={p.imageUrl} symbol={p.base.symbol} size={26} /><span className="flex-1 min-w-0"><span className="font-medium">{p.base.symbol}</span> <span className="text-muted text-xs truncate">{p.base.name}</span><span className="block"><ChainLabel chain={p.chain} /> <span className="text-[11px] text-faint">· {shortAddress(p.base.address)}</span></span></span><span className="text-right num text-xs"><span className="block">{formatPrice(p.priceUsd)}</span><span className="text-muted">Liq {formatUsd(p.liquidityUsd)}</span></span></>),
  }));

  const go = (href: string) => { onClose(); router.push(href); };

  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="flex items-center gap-2 px-4 border-b border-line">
        <Search size={17} className="text-muted" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === "Enter" && items[active]) go(items[active].href);
          }}
          placeholder="Search by name, symbol or paste a contract address"
          className="flex-1 bg-transparent h-14 outline-none text-[15px] placeholder:text-faint"
          aria-label="Search"
        />
        {loading && <Loader2 size={16} className="animate-spin text-muted" />}
      </div>
      <div className="max-h-[60vh] overflow-y-auto scroll-thin p-2">
        {!res && <div className="px-3 py-6 text-xs text-muted text-center">Search across listed coins and on-chain tokens on Solana, Ethereum, Base, BNB Chain, Polygon, Arbitrum and more.</div>}
        {res && res.addressQuery && !items.length && !loading && <div className="px-3 py-6 text-sm text-muted text-center">No trading pairs found for {shortAddress(res.addressQuery.address, 6, 6)} on supported chains.</div>}
        {res && !res.addressQuery && !items.length && !loading && <div className="px-3 py-6 text-sm text-muted text-center">No results for “{q}”.</div>}
        {res?.coins.length ? <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-faint">Listed coins</div> : null}
        {items.map((it, i) => (
          <div key={it.key}>
            {i === (res?.coins.length ?? 0) && res?.pairs.length ? <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-faint">On-chain tokens</div> : null}
            <button
              onMouseEnter={() => setActive(i)}
              onClick={() => go(it.href)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm ${active === i ? "bg-surface-3" : ""}`}
            >
              {it.render}
              {active === i && <ArrowRight size={14} className="text-muted" />}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

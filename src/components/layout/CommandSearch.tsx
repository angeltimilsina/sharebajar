"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search, Loader2, ArrowRight, X, Clock } from "lucide-react";
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

const RECENT = "bajar.search.recent";
type Recent = { href: string; label: string; sub?: string };
const loadRecent = (): Recent[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? "[]").slice(0, 6); } catch { return []; } };
const saveRecent = (r: Recent) => { try { localStorage.setItem(RECENT, JSON.stringify([r, ...loadRecent().filter((x) => x.href !== r.href)].slice(0, 6))); } catch { /* private mode */ } };

/**
 * Search. Phones: a full-screen view with the field at the top and a Cancel
 * button (no bottom sheet that jumps with the keyboard, 16px text so iOS
 * doesn't zoom). Desktop: a centred dialog with keyboard navigation.
 */
function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setQ(""); setRes(null); setLoading(false); return; }
    setRecent(loadRecent());
    // Focus synchronously-ish so mobile browsers open the keyboard from the tap.
    inputRef.current?.focus();
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const html = document.documentElement, prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); html.style.overflow = prev; };
  }, [open, onClose]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(null); setLoading(false); return; }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => r.json()).then((d: SearchResult) => { setRes(d); setActive(0); setLoading(false); })
        .catch((e) => { if ((e as Error).name !== "AbortError") setLoading(false); });
    }, 220);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const items: (Item & { recent: Recent })[] = [];
  res?.coins.forEach((c) => items.push({
    key: `c:${c.id}`, href: `/coin/${c.id}`, recent: { href: `/coin/${c.id}`, label: c.name, sub: c.symbol },
    render: (<><TokenIcon src={c.thumb} symbol={c.symbol} size={30} canonical /><span className="flex-1 min-w-0"><span className="font-medium">{c.name}</span> <span className="text-muted text-xs">{c.symbol}</span></span>{c.rank && <Badge>#{c.rank}</Badge>}</>),
  }));
  res?.pairs.forEach((p) => {
    const href = `/token/${p.chain}/${p.base.address}${p.pairAddress ? `?pair=${p.pairAddress}` : ""}`;
    items.push({
      key: `p:${p.chain}:${p.base.address}`, href, recent: { href, label: p.base.symbol, sub: p.base.name },
      render: (<><TokenIcon src={p.imageUrl} symbol={p.base.symbol} size={30} /><span className="flex-1 min-w-0"><span className="font-medium">{p.base.symbol}</span> <span className="text-muted text-xs truncate">{p.base.name}</span><span className="block"><ChainLabel chain={p.chain} /> <span className="text-[11px] text-faint">· {shortAddress(p.base.address)}</span></span></span><span className="text-right num text-xs shrink-0"><span className="block">{formatPrice(p.priceUsd)}</span><span className="text-muted">Liq {formatUsd(p.liquidityUsd)}</span></span></>),
    });
  });

  const go = (href: string, r?: Recent) => { if (r) saveRecent(r); onClose(); router.push(href); };
  if (!open || typeof document === "undefined") return null;

  // Portal to <body> so the sheet sits above the sticky header and the tab bar.
  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Search" data-testid="search-dialog">
      <div className="hidden sm:block absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="absolute inset-0 sm:inset-auto sm:left-1/2 sm:top-[12vh] sm:-translate-x-1/2 sm:w-[min(640px,92vw)] flex flex-col bg-bg sm:bg-surface sm:rounded-[22px] sm:border-[0.5px] sm:border-line-strong sm:shadow-[var(--shadow-lg)] overflow-hidden pt-[env(safe-area-inset-top)] sm:pt-0">
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-0 sm:border-b border-line">
          <label className="flex-1 min-w-0 flex items-center gap-2 h-11 sm:h-14 rounded-xl sm:rounded-none bg-surface-2 sm:bg-transparent px-3 sm:px-0">
            <Search size={17} className="text-muted shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                if (e.key === "Enter" && items[active]) go(items[active].href, items[active].recent);
              }}
              placeholder="Coin, token or contract address"
              className="no-ring flex-1 min-w-0 bg-transparent outline-none text-[16px] placeholder:text-faint"
              aria-label="Search"
              inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            />
            {loading ? <Loader2 size={16} className="animate-spin text-muted shrink-0" /> : q && (
              <button type="button" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Clear search" className="h-5 w-5 grid place-items-center rounded-full bg-surface-3 text-muted shrink-0"><X size={12} /></button>
            )}
          </label>
          <button onClick={onClose} className="sm:hidden shrink-0 text-brand text-[16px] font-medium px-1.5" data-testid="search-cancel">Cancel</button>
        </div>
        <div className="flex-1 sm:flex-none sm:max-h-[60vh] overflow-y-auto overscroll-contain scroll-thin p-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
          {!res && !recent.length && <div className="px-3 py-6 text-[13px] text-muted text-center">Search listed coins and on-chain tokens on Solana, Ethereum, Base, BNB Chain, Polygon, Arbitrum and more. Paste a contract address to find its pools.</div>}
          {!res && recent.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-faint">Recent<button className="normal-case tracking-normal text-[12px] text-brand" onClick={() => { try { localStorage.removeItem(RECENT); } catch { /* ignore */ } setRecent([]); }}>Clear</button></div>
              {recent.map((r) => (
                <button key={r.href} onClick={() => go(r.href, r)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[15px] hover:bg-surface-2 active:bg-surface-2">
                  <Clock size={15} className="text-muted shrink-0" /><span className="font-medium">{r.label}</span>{r.sub && <span className="text-muted text-[13px] truncate">{r.sub}</span>}
                </button>
              ))}
            </>
          )}
          {res && res.addressQuery && !items.length && !loading && <div className="px-3 py-6 text-sm text-muted text-center">No trading pairs found for {shortAddress(res.addressQuery.address, 6, 6)} on supported chains.</div>}
          {res && !res.addressQuery && !items.length && !loading && <div className="px-3 py-6 text-sm text-muted text-center">No results for “{q}”.</div>}
          {res?.coins.length ? <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-faint">Listed coins</div> : null}
          {items.map((it, i) => (
            <div key={it.key}>
              {i === (res?.coins.length ?? 0) && res?.pairs.length ? <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-faint">On-chain tokens</div> : null}
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(it.href, it.recent)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm ${active === i ? "sm:bg-surface-2" : ""} active:bg-surface-2`}
              >
                {it.render}
                {active === i && <ArrowRight size={14} className="text-muted hidden sm:block" />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

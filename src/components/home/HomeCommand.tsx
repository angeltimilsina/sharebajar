"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowUp, Loader2, Search, ShoppingBag } from "lucide-react";
import { formatPrice, formatUsd } from "@/lib/format";

interface Hit { chain: string; address: string; name: string; dex: string; base: { address: string; symbol: string; name: string; image: string | null }; priceUsd: number | null; liquidityUsd: number | null; priceChangePct: { h24: number | null } }
type Mode = "tokens" | "agents";

/**
 * Home command bar: search any token (name, symbol or contract, every chain)
 * through the public API, or hand a shopping request to BAJAR Agents.
 */
export function HomeCommand() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("tokens");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (mode !== "tokens") return;
    const term = q.trim();
    if (term.length < 2) { setHits(null); setState("idle"); return; }
    const t = setTimeout(async () => {
      ctl.current?.abort();
      const ac = new AbortController();
      ctl.current = ac;
      setState("loading");
      try {
        const r = await fetch(`/api/v1/search?q=${encodeURIComponent(term)}`, { signal: ac.signal });
        const b = await r.json();
        if (!r.ok) { setErr(b.error?.message ?? "Search is unavailable right now."); setState("error"); setHits(null); return; }
        setHits(b.data); setErr(null); setState("idle");
      } catch (e) { if ((e as Error).name !== "AbortError") { setErr("Search is unavailable right now."); setState("error"); } }
    }, 250);
    return () => clearTimeout(t);
  }, [q, mode]);

  const submit = () => {
    const term = q.trim();
    if (!term) return;
    if (mode === "agents") router.push(`/agents?q=${encodeURIComponent(term)}`);
    else if (hits?.[0]) router.push(`/token/${hits[0].chain}/${hits[0].base.address}`);
  };

  return (
    <section className="rounded-[28px] bg-surface border border-line p-4 sm:p-6" data-testid="home-command">
      <h2 className="text-[22px] sm:text-[28px] font-semibold tracking-tight leading-tight">Discover any token. Launch. Trade. <span className="text-brand">Shop with crypto.</span></h2>
      <div className="mt-3 inline-flex rounded-full bg-surface-2 p-1" role="tablist" aria-label="Search mode">
        {(["tokens", "agents"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setHits(null); }} data-testid={`mode-${m}`}
            className={clsx("h-8 px-3.5 rounded-full text-[13px] font-semibold inline-flex items-center gap-1.5", mode === m ? "bg-surface text-fg shadow-sm" : "text-muted")}>
            {m === "tokens" ? <Search size={14} /> : <ShoppingBag size={14} />}{m === "tokens" ? "Tokens" : "Agents"}
          </button>
        ))}
      </div>
      <form className="mt-3 relative" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={mode === "tokens" ? "Search tokens" : "Ask BAJAR Agents"} data-testid="home-command-input"
          placeholder={mode === "tokens" ? "Token name, symbol or contract address" : "e.g. #Compare wireless headphones under $200"}
          className="w-full h-12 rounded-2xl bg-surface-2 pl-4 pr-12 text-[16px] outline-none focus:ring-2 focus:ring-[var(--brand-fill)]" />
        <button type="submit" aria-label="Go" className="absolute right-1.5 top-1.5 h-9 w-9 rounded-full btn-ink grid place-items-center">
          {state === "loading" ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} />}
        </button>
      </form>
      {mode === "tokens" && state === "error" && <p className="mt-2 text-[13px] text-down" data-testid="home-search-error">{err}</p>}
      {mode === "tokens" && hits && (
        <ul className="mt-2 divide-y divide-[var(--border)]" data-testid="home-search-results">
          {hits.length === 0 && <li className="py-3 text-[13.5px] text-muted">No tokens found on supported chains.</li>}
          {hits.slice(0, 8).map((h) => (
            <li key={`${h.chain}:${h.address}`}>
              <Link href={`/token/${h.chain}/${h.base.address}`} className="flex items-center gap-3 py-2.5 hover:bg-surface-2 rounded-xl px-2 -mx-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {h.base.image ? <img src={h.base.image} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" /> : <span className="h-8 w-8 rounded-full bg-surface-2 grid place-items-center text-[11px] font-semibold">{h.base.symbol.slice(0, 3)}</span>}
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-medium truncate">{h.base.symbol} <span className="text-muted font-normal">{h.base.name}</span></div>
                  <div className="text-[12px] text-faint capitalize">{h.chain} · {h.dex} · liquidity {h.liquidityUsd === null ? "—" : formatUsd(h.liquidityUsd, 1)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] num">{formatPrice(h.priceUsd)}</div>
                  {h.priceChangePct.h24 !== null && <div className={clsx("text-[12px] num", h.priceChangePct.h24 >= 0 ? "text-up" : "text-down")}>{h.priceChangePct.h24 >= 0 ? "+" : ""}{h.priceChangePct.h24.toFixed(2)}%</div>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

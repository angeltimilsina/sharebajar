"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { TICKER } from "../layout/TickerBar";
import { useLiveTickers } from "@/hooks/useBinance";
import { formatPrice } from "@/lib/format";
import { TokenIcon } from "../ui/TokenIcon";
import { Pct } from "../ui/primitives";

export const MAJORS = TICKER.map((t) => ({ ...t, pair: `${t.s}USDT` }));

export function MarketPicker({ value, onChange }: { value: string; onChange: (pair: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const live = useLiveTickers(MAJORS.map((m) => m.pair));
  useEffect(() => {
    const on = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, []);
  const cur = MAJORS.find((m) => m.pair === value);
  const t = live[value];
  const list = MAJORS.filter((m) => m.s.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 h-12 rounded-xl border border-line bg-surface px-3 hover:bg-surface-2" aria-expanded={open}>
        <TokenIcon src={cur?.img} symbol={cur?.s ?? value} size={26} />
        <span className="text-left"><span className="block font-bold leading-tight">{cur?.s ?? value.replace("USDT", "")}<span className="text-muted font-medium">/USDT</span></span><span className="text-[11px] text-muted">Binance spot</span></span>
        <span className="num font-semibold ml-2">{t ? formatPrice(t.price) : "—"}</span>
        <Pct v={t?.change24h} className="text-xs" />
        <ChevronDown size={15} className="text-muted" />
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-80 panel glass p-2">
          <div className="flex items-center gap-2 h-9 rounded-lg bg-surface-2 px-2.5 mb-1"><Search size={14} className="text-muted" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter markets" className="bg-transparent outline-none text-sm flex-1" /></div>
          <ul className="max-h-80 overflow-y-auto scroll-thin">
            {list.map((m) => (
              <li key={m.pair}>
                <button onClick={() => { onChange(m.pair); setOpen(false); }} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-surface-3 text-sm">
                  <TokenIcon src={m.img} symbol={m.s} size={22} /><span className="font-semibold flex-1 text-left">{m.s}/USDT</span>
                  <span className="num">{live[m.pair] ? formatPrice(live[m.pair].price) : "—"}</span>
                  <Pct v={live[m.pair]?.change24h} className="text-xs w-16 text-right" />
                </button>
              </li>
            ))}
          </ul>
          <button onClick={() => { setOpen(false); window.dispatchEvent(new Event("sb-open-search")); }} className="w-full text-xs text-brand py-2">Search any token or contract →</button>
        </div>
      )}
    </div>
  );
}

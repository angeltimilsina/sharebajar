"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutGrid } from "lucide-react";
import clsx from "clsx";
import { CHAINS, PRIMARY_CHAIN_IDS } from "@/lib/chains";
import { ChainIcon } from "../ui/ChainIcon";

export function NetworkFilter({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [more, setMore] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMore(false); };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, []);
  const primary = CHAINS.filter((c) => PRIMARY_CHAIN_IDS.includes(c.id));
  const rest = CHAINS.filter((c) => !PRIMARY_CHAIN_IDS.includes(c.id));
  const chip = (active: boolean) => clsx("h-9 shrink-0 inline-flex items-center gap-2 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors", active ? "border-brand/50 bg-brand-soft text-fg" : "border-line bg-surface hover:bg-surface-2 text-fg/90");
  const restActive = rest.find((c) => c.id === value);
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1 min-w-0" role="radiogroup" aria-label="Network">
        <button role="radio" aria-checked={value === "all"} className={chip(value === "all")} onClick={() => onChange("all")}><LayoutGrid size={15} className={value === "all" ? "text-brand" : ""} /> All Networks</button>
        {primary.map((c) => (
          <button key={c.id} role="radio" aria-checked={value === c.id} className={chip(value === c.id)} onClick={() => onChange(c.id)}><ChainIcon chain={c.id} size={17} /> {c.name}</button>
        ))}
      </div>
      <div ref={ref} className="relative shrink-0">
        <button className={chip(!!restActive)} onClick={() => setMore((m) => !m)} aria-expanded={more}>
          {restActive ? <><ChainIcon chain={restActive.id} size={16} /> {restActive.name}</> : "More"} <ChevronDown size={14} />
        </button>
        {more && (
          <div className="absolute right-0 mt-2 w-48 panel glass p-1.5 z-30">
            {rest.map((c) => (
              <button key={c.id} onClick={() => { onChange(c.id); setMore(false); }} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm hover:bg-surface-3"><ChainIcon chain={c.id} size={16} /> {c.name}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

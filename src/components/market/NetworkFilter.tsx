"use client";
import { LayoutGrid } from "lucide-react";
import clsx from "clsx";
import { CHAINS } from "@/lib/chains";
import { ChainIcon } from "../ui/ChainIcon";

/** Every network as a chip in one swipeable row (no overflow menu). */
export function NetworkFilter({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const chip = (active: boolean) => clsx("h-9 shrink-0 inline-flex items-center gap-2 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors", active ? "border-brand/50 bg-brand-soft text-fg" : "border-line bg-surface hover:bg-surface-2 text-fg/90");
  return (
    <div className={clsx("flex items-center gap-2 overflow-x-auto no-scrollbar -mx-3 px-3 sm:mx-0 sm:px-0", className)} role="radiogroup" aria-label="Network">
      <button role="radio" aria-checked={value === "all"} className={chip(value === "all")} onClick={() => onChange("all")}><LayoutGrid size={15} className={value === "all" ? "text-brand" : ""} /> All Networks</button>
      {CHAINS.map((c) => (
        <button key={c.id} role="radio" aria-checked={value === c.id} className={chip(value === c.id)} onClick={() => onChange(c.id)}><ChainIcon chain={c.id} size={17} /> {c.name}</button>
      ))}
    </div>
  );
}

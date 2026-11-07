import clsx from "clsx";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { formatPct, pctClass } from "@/lib/format";

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("panel", className)} {...rest}>{children}</div>;
}

export function CardHeader({ title, icon, action, sub }: { title: ReactNode; icon?: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">{title}{icon}</h2>
        {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

export function Pct({ v, className, digits = 2 }: { v: number | null | undefined; className?: string; digits?: number }) {
  return <span className={clsx("num", pctClass(v), className)}>{formatPct(v, digits)}</span>;
}

type BtnVariant = "primary" | "outline" | "ghost" | "subtle" | "danger";
export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-[15px]",
        variant === "primary" && "bg-brand text-brand-ink hover:bg-brand-strong shadow-[0_0_24px_-6px_var(--brand)]",
        variant === "outline" && "border border-brand/60 text-fg hover:bg-brand-soft",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-surface-2",
        variant === "subtle" && "bg-surface-2 border border-line text-fg hover:bg-surface-3",
        variant === "danger" && "bg-down/90 text-white hover:bg-down",
        className,
      )}
      {...rest}
    />
  );
}

export function Badge({ tone = "neutral", children, className, title }: { tone?: "neutral" | "up" | "down" | "warn" | "brand" | "ai" | "info"; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold leading-none whitespace-nowrap",
        tone === "neutral" && "bg-surface-3 text-muted",
        tone === "up" && "bg-up/12 text-up",
        tone === "down" && "bg-down/12 text-down",
        tone === "warn" && "bg-warn/14 text-warn",
        tone === "brand" && "bg-brand-soft text-brand",
        tone === "ai" && "bg-ai/15 text-ai",
        tone === "info" && "bg-sky-500/12 text-sky-400",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-1.5 py-10 px-6 text-muted">
      {icon}
      <div className="text-sm font-medium text-fg">{title}</div>
      {children && <div className="text-xs max-w-sm">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warn" | "down" | "ai"; title?: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="note"
      className={clsx(
        "rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed",
        tone === "info" && "border-line bg-surface-2 text-muted",
        tone === "warn" && "border-warn/30 bg-warn/8 text-warn",
        tone === "down" && "border-down/30 bg-down/8 text-down",
        tone === "ai" && "border-ai/30 bg-ai/8 text-fg",
        className,
      )}
    >
      {title && <div className="font-semibold mb-0.5 text-fg">{title}</div>}
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className, size = "md" }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; size?: "sm" | "md" }) {
  return (
    <div role="tablist" className={clsx("flex items-center gap-1 overflow-x-auto no-scrollbar", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            "relative whitespace-nowrap font-medium transition-colors",
            size === "md" ? "px-3 py-2.5 text-sm" : "px-2.5 py-1.5 text-xs rounded-md",
            size === "md" && (value === t.id ? "text-fg" : "text-muted hover:text-fg"),
            size === "sm" && (value === t.id ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"),
          )}
        >
          {t.label}
          {size === "md" && value === t.id && <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-brand shadow-[0_0_10px_var(--brand)]" />}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={clsx("min-w-0", className)}>
      <div className="text-[11px] text-muted truncate">{label}</div>
      <div className="num text-[15px] font-semibold mt-0.5 truncate">{value}</div>
      {sub && <div className="text-[11px] mt-0.5">{sub}</div>}
    </div>
  );
}

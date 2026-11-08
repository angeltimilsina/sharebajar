import clsx from "clsx";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { formatPct, pctClass } from "@/lib/format";

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("panel", className)} {...rest}>{children}</div>;
}

export function CardHeader({ title, icon, action, sub }: { title: ReactNode; icon?: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-[17px] leading-tight">{title}{icon}</h2>
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
        "inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-colors select-none disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100",
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px] rounded-2xl",
        variant === "primary" && "btn-ink",
        variant === "outline" && "border border-line-strong bg-surface text-fg hover:bg-surface-2",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-surface-2",
        variant === "subtle" && "bg-surface-2 text-fg hover:bg-surface-3",
        variant === "danger" && "bg-down text-white hover:opacity-90",
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
        "inline-flex items-center gap-1 rounded-full px-2 py-[3px] font-sans text-[11px] font-medium leading-none whitespace-nowrap tracking-normal",
        tone === "neutral" && "bg-surface-3 text-muted",
        tone === "up" && "bg-up/12 text-up",
        tone === "down" && "bg-down/12 text-down",
        tone === "warn" && "bg-warn/14 text-warn",
        tone === "brand" && "bg-brand-soft text-fg",
        tone === "ai" && "bg-ai/14 text-ai",
        tone === "info" && "bg-sky-500/12 text-sky-500",
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
      <div className="font-display text-base text-fg">{title}</div>
      {children && <div className="text-xs max-w-sm">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warn" | "down" | "ai"; title?: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="note"
      className={clsx(
        "rounded-2xl border px-4 py-3 text-[13px] leading-relaxed",
        tone === "info" && "border-line bg-surface-2 text-muted",
        tone === "warn" && "border-warn/25 bg-warn/[0.07] text-warn",
        tone === "down" && "border-down/25 bg-down/[0.07] text-down",
        tone === "ai" && "border-ai/25 bg-ai/[0.07] text-fg",
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
    <div role="tablist" className={clsx("flex items-center gap-1 overflow-x-auto no-scrollbar", size === "md" && "rounded-full bg-surface-2 p-1 w-fit max-w-full", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            "relative whitespace-nowrap font-medium transition-all",
            size === "md" ? "px-3.5 py-1.5 text-sm rounded-full" : "px-2.5 py-1.5 text-xs rounded-lg",
            size === "md" && (value === t.id ? "bg-surface text-fg shadow-[var(--shadow)]" : "text-muted hover:text-fg"),
            size === "sm" && (value === t.id ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"),
          )}
        >
          {t.label}
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

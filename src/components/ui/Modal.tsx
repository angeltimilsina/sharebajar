"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";

export function Modal({ open, onClose, title, children, className, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; className?: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={clsx("relative w-full panel glass outline-none max-h-[88dvh] sm:max-h-[86vh] overflow-y-auto overscroll-contain scroll-thin !rounded-b-none !rounded-t-2xl sm:!rounded-[14px] pb-[env(safe-area-inset-bottom)] sm:pb-0", wide ? "max-w-2xl" : "max-w-md", className)}
      >
        <div className="sm:hidden mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
        {title && (
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-muted hover:text-fg hover:bg-surface-3"><X size={16} /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

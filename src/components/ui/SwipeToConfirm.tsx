"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronsRight, Loader2 } from "lucide-react";

/**
 * Swipe-to-confirm track (iOS style). Drag the knob to the end to confirm;
 * releasing early springs it back. Keyboard: focus the knob and press Enter
 * or Space. A deliberate gesture only — the action it starts (e.g. a wallet
 * signature) still asks for its own approval.
 */
export function SwipeToConfirm({ label, busyLabel, busy, disabled, onConfirm, testId }: { label: ReactNode; busyLabel?: ReactNode; busy?: boolean; disabled?: boolean; onConfirm: () => void; testId?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; id: number } | null>(null);
  const [x, setX] = useState(0);
  const [done, setDone] = useState(false);
  const KNOB = 48, PAD = 4;
  const max = () => Math.max(1, (track.current?.clientWidth ?? 300) - KNOB - PAD * 2);

  // Reset when the action finishes (or fails) so it can be swiped again.
  useEffect(() => { if (!busy) { setDone(false); setX(0); } }, [busy]);
  useEffect(() => { if (disabled) { setX(0); setDone(false); } }, [disabled]);

  const confirm = () => {
    if (disabled || busy || done) return;
    setDone(true); setX(max());
    if (typeof navigator !== "undefined" && "vibrate" in navigator) try { navigator.vibrate(12); } catch { /* unsupported */ }
    onConfirm();
  };

  const locked = disabled || busy || done;
  const pct = x / max();
  return (
    <div
      ref={track}
      className={clsx("relative h-14 w-full rounded-full select-none overflow-hidden touch-none", locked && !busy && !done ? "bg-surface-3 opacity-50" : "bg-fg/90")}
      data-testid={testId ? `${testId}-track` : undefined}
      aria-disabled={disabled || undefined}
    >
      <div className="absolute inset-y-0 left-0 rounded-full bg-accent/40" style={{ width: x + KNOB + PAD * 2, transition: start.current ? "none" : "width 200ms ease" }} aria-hidden />
      <div className="absolute inset-0 grid place-items-center pl-12 pr-4 text-[14.5px] font-medium text-[var(--bg)] pointer-events-none" style={{ opacity: busy || done ? 1 : 1 - pct * 1.2 }}>
        {busy || done ? <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />{busyLabel ?? "Working…"}</span> : <span className="truncate">{label}</span>}
      </div>
      <button
        type="button"
        role="slider"
        aria-label={typeof label === "string" ? `Swipe to ${label.replace(/^swipe to /i, "")}` : "Swipe to confirm"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        aria-valuetext={done ? "Confirmed" : "Swipe right to confirm, or press Enter"}
        disabled={locked}
        data-testid={testId}
        className="absolute top-1 left-1 h-12 w-12 rounded-full bg-[var(--bg)] text-fg grid place-items-center shadow cursor-grab active:cursor-grabbing disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent"
        style={{ transform: `translateX(${x}px)`, transition: start.current ? "none" : "transform 220ms cubic-bezier(.2,.9,.3,1.2)" }}
        onPointerDown={(e) => { if (locked) return; start.current = { x: e.clientX - x, id: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!start.current || start.current.id !== e.pointerId) return; setX(Math.min(max(), Math.max(0, e.clientX - start.current.x))); }}
        onPointerUp={(e) => {
          if (!start.current) return;
          start.current = null;
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
          if (x >= max() * 0.9) confirm(); else setX(0);
        }}
        onPointerCancel={() => { start.current = null; setX(0); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); confirm(); } }}
      >
        <ChevronsRight size={20} />
      </button>
    </div>
  );
}

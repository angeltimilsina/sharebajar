import { useId } from "react";

/** Lightweight SVG sparkline. Color follows direction unless overridden. */
export function Sparkline({ data, width = 110, height = 32, color, fill = true, className }: { data: number[]; width?: number; height?: number; color?: string; fill?: boolean; className?: string }) {
  const id = useId();
  if (!data || data.length < 2) return <div style={{ width, height }} className={className} />;
  const step = Math.max(1, Math.floor(data.length / 80));
  const pts = data.filter((_, i) => i % step === 0 || i === data.length - 1);
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * width, height - 2 - ((v - min) / range) * (height - 4)] as const);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const c = color ?? (pts[pts.length - 1] >= pts[0] ? "var(--up)" : "var(--down)");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden preserveAspectRatio="none">
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity="0.28" />
              <stop offset="100%" stopColor={c} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d}L${width},${height}L0,${height}Z`} fill={`url(#${id})`} />
        </>
      )}
      <path d={d} fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

const pctStr = (v: number | null) => (v === null ? "" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);

/** Shared Open Graph card: warm dark background, serif headline, live figures. */
export function ogCard({ eyebrow, title, rows }: { eyebrow: string; title: string; rows: { label: string; value: string; change?: number | null }[] }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#000000", color: "#ffffff", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontFamily: "sans-serif", color: "#c9c6bd" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {[44, 30, 38].map((w, i) => <div key={i} style={{ width: w, height: 6, borderRadius: 3, background: "#e8e6dc" }} />)}
          </div>
          <span style={{ marginLeft: 6 }}>Bajar</span>
          <span style={{ color: "#8b887f" }}>· {eyebrow}</span>
        </div>
        <div style={{ fontSize: title.length > 34 ? 64 : 80, lineHeight: 1.08, display: "flex" }}>{title}</div>
        <div style={{ display: "flex", gap: 56, fontFamily: "sans-serif" }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 24, color: "#8b887f" }}>{r.label}</span>
              <span style={{ fontSize: 44, display: "flex", gap: 14, alignItems: "baseline" }}>
                {r.value}
                {r.change !== undefined && r.change !== null && <span style={{ fontSize: 28, color: r.change >= 0 ? "#6fbf8a" : "#e07a6b" }}>{pctStr(r.change)}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
    OG_SIZE,
  );
}

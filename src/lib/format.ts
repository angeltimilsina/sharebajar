const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
const toSubscript = (n: number) => String(n).split("").map((d) => SUBSCRIPT[Number(d)]).join("");

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Price formatting for anything from BTC to micro-cap memecoins.
 * Very small values use subscript zero-compression: 0.0000027 → $0.0₅27
 */
export function formatPrice(v: number | null | undefined, opts: { currency?: boolean } = {}): string {
  const prefix = opts.currency === false ? "" : "$";
  if (!isNum(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a === 0) return `${prefix}0.00`;
  if (a >= 1000) return `${sign}${prefix}${a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (a >= 1) return `${sign}${prefix}${a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  if (a >= 0.001) return `${sign}${prefix}${a.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;
  const exp = Math.floor(Math.log10(a));
  const zeros = -exp - 1;
  const digits = Math.round(a * 10 ** (-exp + 3)).toString().slice(0, 4).replace(/0+$/, "") || "0";
  return `${sign}${prefix}0.0${toSubscript(zeros)}${digits}`;
}

/** Compact USD: $1.91T, $52.48B, $842.10M, $12.3K */
export function formatUsd(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(digits)}K`;
  return `${sign}$${a.toFixed(a >= 1 ? 2 : 4)}`;
}

export function formatNumber(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(digits)}K`;
  return `${sign}${a.toLocaleString("en-US", { maximumFractionDigits: a < 1 ? 6 : digits })}`;
}

export function formatPct(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function pctClass(v: number | null | undefined): string {
  if (!isNum(v) || v === 0) return "text-muted";
  return v > 0 ? "text-up" : "text-down";
}

export function shortAddress(a: string, head = 4, tail = 4): string {
  if (!a) return "";
  return a.length <= head + tail + 2 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function timeAgo(ms: number | null | undefined, now = Date.now()): string {
  if (!isNum(ms)) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

export function age(ms: number | null | undefined, now = Date.now()): string {
  return timeAgo(ms, now).replace(" ago", "");
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour12: false });
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

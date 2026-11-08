/** Canonical JSON (sorted keys, undefined dropped) for signing. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

export const toBase = (v: string, decimals: number): bigint | null => {
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  const [i, f = ""] = v.split(".");
  if (f.length > decimals) return null;
  const raw = BigInt((i || "0") + f.padEnd(decimals, "0"));
  return raw > BigInt(0) ? raw : null;
};

export function fromBase(raw: bigint | string, decimals: number): string {
  const r = BigInt(raw);
  const s = r.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

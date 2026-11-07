import type { Pool } from "../types";

export interface Filters { minLiq: string; minVol: string; minFdv: string; maxFdv: string; maxAgeH: string; minChange: string; maxChange: string; hideThin: boolean }
export const EMPTY_FILTERS: Filters = { minLiq: "", minVol: "", minFdv: "", maxFdv: "", maxAgeH: "", minChange: "", maxChange: "", hideThin: false };
const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function applyFilters(pools: Pool[], f: Filters, now = Date.now()): Pool[] {
  return pools.filter((p) => {
    const liq = p.reserveUsd ?? 0;
    if (num(f.minLiq) !== null && liq < num(f.minLiq)!) return false;
    if (num(f.minVol) !== null && (p.volume.h24 ?? 0) < num(f.minVol)!) return false;
    const fdv = p.fdv ?? p.marketCap ?? 0;
    if (num(f.minFdv) !== null && fdv < num(f.minFdv)!) return false;
    if (num(f.maxFdv) !== null && fdv > num(f.maxFdv)!) return false;
    if (num(f.maxAgeH) !== null && (!p.createdAt || now - p.createdAt > num(f.maxAgeH)! * 3600_000)) return false;
    if (num(f.minChange) !== null && (p.change.h24 ?? -Infinity) < num(f.minChange)!) return false;
    if (num(f.maxChange) !== null && (p.change.h24 ?? Infinity) > num(f.maxChange)!) return false;
    if (f.hideThin && liq < 10_000) return false;
    return true;
  });
}


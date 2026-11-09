"use client";
/** Which tracked wallets count toward the Portfolio (stored as the excluded ids). */
const KEY = "bajar.dash.excluded";
export function readExcluded(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
export function writeExcluded(ids: string[]) {
  try { if (ids.length) localStorage.setItem(KEY, JSON.stringify(ids)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}

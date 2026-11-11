import "server-only";
import type { Offer } from "./types";
import { shopifyStores } from "./registry";
import { parseProductLink } from "./url";
import { shopifyProduct, shopifySearch } from "./providers/shopify";
import { fetchProductPage } from "./providers/jsonld";
import { bestbuyEnabled, bestbuyItem, bestbuySearch, ebayEnabled, ebayItem, ebaySearch } from "./providers/apis";
import { sandboxItem, sandboxSearch } from "./providers/sandbox";

export interface SourceRun { source: string; ok: boolean; count: number; ms: number; error?: string }

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);

/** Search every enabled provider in parallel; each has its own timeout. Returns offers + a per-source log (evidence). */
export async function searchCatalog(q: string, opts: { maxPrice?: number; sandbox?: boolean; limitPerStore?: number } = {}): Promise<{ offers: Offer[]; runs: SourceRun[] }> {
  const jobs: { source: string; run: () => Promise<Offer[]> }[] = [];
  if (opts.sandbox) jobs.push({ source: "Bajar Test Store (sandbox)", run: async () => sandboxSearch(q, opts.maxPrice) });
  for (const s of shopifyStores()) jobs.push({ source: `${s.name} (Shopify)`, run: () => shopifySearch(s.domain, s.name, q, opts.limitPerStore ?? 3) });
  if (ebayEnabled()) jobs.push({ source: "eBay", run: () => ebaySearch(q, 6, opts.maxPrice) });
  if (bestbuyEnabled()) jobs.push({ source: "Best Buy", run: () => bestbuySearch(q, 6, opts.maxPrice) });
  const runs: SourceRun[] = [];
  const results = await Promise.all(jobs.map(async (j) => {
    const t = Date.now();
    try {
      const r = await withTimeout(j.run(), 9000);
      runs.push({ source: j.source, ok: true, count: r.length, ms: Date.now() - t });
      return r;
    } catch (e) {
      runs.push({ source: j.source, ok: false, count: 0, ms: Date.now() - t, error: String((e as Error).message).slice(0, 80) });
      return [];
    }
  }));
  let offers = dedupe(results.flat());
  if (opts.maxPrice !== undefined) offers = offers.filter((o) => o.price !== null && o.price <= opts.maxPrice!);
  return { offers, runs };
}

/** Same product listed twice (same store + title + price) collapses to one. */
export function dedupe(list: Offer[]): Offer[] {
  const seen = new Map<string, Offer>();
  for (const o of list) {
    const k = `${o.merchantDomain}|${o.title.toLowerCase().replace(/\s+/g, " ").trim()}|${o.price ?? ""}`;
    if (!seen.has(k)) seen.set(k, o);
  }
  return [...seen.values()];
}

/** Resolve a pasted product link to an offer, using the best source for that retailer. */
export async function productFromLink(input: string): Promise<{ offer: Offer | null; retailer: string; warnings: string[]; blocked?: string; note?: string }> {
  const p = parseProductLink(input);
  if (!p.ok) return { offer: null, retailer: "web", warnings: p.warnings, blocked: p.blocked };
  const sandboxId = new URL(p.url!).hostname.endsWith("sharebajar.com") ? new URL(input).searchParams.get("product") : null;
  if (sandboxId) return { offer: sandboxItem(sandboxId), retailer: "bajar-sandbox", warnings: [] };
  const host = p.host!;
  try {
    if (p.retailer === "ebay" && p.productId && ebayEnabled()) return { offer: await ebayItem(p.productId), retailer: "ebay", warnings: p.warnings };
    if (p.retailer === "bestbuy" && p.productId && bestbuyEnabled()) return { offer: await bestbuyItem(p.productId), retailer: "bestbuy", warnings: p.warnings };
    if (["amazon", "walmart", "target", "ebay", "bestbuy"].includes(p.retailer!)) {
      // No configured API: try the page's own product data (often blocked by these sites).
      const r = await fetchProductPage(p.url!, host);
      if (r.offer) return { offer: { ...r.offer, retailer: p.retailer!, merchant: r.offer.merchant }, retailer: p.retailer!, warnings: p.warnings };
      return { offer: null, retailer: p.retailer!, warnings: p.warnings, note: `${r.blocked ?? "No product data."} Live ${p.retailer} pricing needs its official API.` };
    }
    if (p.productId && /\/products\//.test(p.url!)) {
      const store = host.replace(/^www\./, "");
      const s = await shopifyProduct(host, shopifyStores().find((x) => x.domain === host)?.name ?? store, p.productId).catch(() => null);
      if (s) return { offer: s, retailer: "shopify", warnings: p.warnings };
    }
    const r = await fetchProductPage(p.url!, host);
    return { offer: r.offer, retailer: "web", warnings: p.warnings, note: r.blocked };
  } catch (e) {
    return { offer: null, retailer: p.retailer ?? "web", warnings: p.warnings, note: String((e as Error).message).slice(0, 120) };
  }
}

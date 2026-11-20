import { NextResponse } from "next/server";
import { searchCatalog } from "@/lib/commerce/catalog";

/** Trending deals: real merchant discounts (compare-at above price) from the connected stores. Cached briefly. */
let cache: { at: number; body: unknown } | null = null;
export async function GET() {
  if (cache && Date.now() - cache.at < 10 * 60_000) return NextResponse.json(cache.body);
  const terms = ["headphones", "backpack", "sneakers", "phone case"];
  const res = await Promise.all(terms.map((t) => searchCatalog(t, { sandbox: false, limitPerStore: 4 }).catch(() => ({ offers: [], runs: [] }))));
  const offers = res.flatMap((r) => r.offers).filter((o) => o.price && o.compareAtPrice && o.compareAtPrice > o.price && o.inStock !== false);
  const seen = new Set<string>();
  const deals = offers.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true))).sort((a, b) => (1 - a.price! / a.compareAtPrice!) > (1 - b.price! / b.compareAtPrice!) ? -1 : 1).slice(0, 12);
  const body = { deals, at: Date.now(), sources: [...new Set(res.flatMap((r) => r.runs.filter((x) => x.ok).map((x) => x.source)))] };
  if (deals.length) cache = { at: Date.now(), body };
  return NextResponse.json(body);
}

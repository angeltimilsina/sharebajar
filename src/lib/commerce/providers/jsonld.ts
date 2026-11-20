import "server-only";
import type { Offer } from "../types";

/**
 * Reads the product data a page publishes for search engines (schema.org
 * JSON-LD, then Open Graph tags). Many big retailers block automated reads;
 * then we say so instead of guessing.
 */
type LD = Record<string, unknown>;
const first = <T,>(x: T | T[] | undefined): T | undefined => (Array.isArray(x) ? x[0] : x);

function findProduct(node: unknown): LD | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findProduct(n); if (r) return r; } return null; }
  const o = node as LD;
  const t = o["@type"];
  if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return o;
  if (o["@graph"]) return findProduct(o["@graph"]);
  return null;
}

export function parseProductHtml(html: string, url: string, domain: string): Offer | null {
  let product: LD | null = null;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { product = findProduct(JSON.parse(m[1].trim())); } catch { /* skip invalid block */ }
    if (product) break;
  }
  const meta = (prop: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i").exec(html)?.[1] ?? new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i").exec(html)?.[1];
  const dec = (s?: string) => s?.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  if (product) {
    const offer = first(product.offers as LD | LD[] | undefined) as LD | undefined;
    const agg = offer && (offer["@type"] === "AggregateOffer") ? offer : undefined;
    const price = Number(offer?.price ?? agg?.lowPrice ?? (offer?.priceSpecification as LD | undefined)?.price);
    const avail = String(offer?.availability ?? "");
    const brand = product.brand as LD | string | undefined;
    const imgs = ([] as unknown[]).concat(product.image ?? []).map((x) => (typeof x === "string" ? x : (x as LD)?.url)).filter((x): x is string => typeof x === "string").slice(0, 6);
    return {
      id: `web:${domain}:${String(product.sku ?? product.gtin13 ?? product.mpn ?? url)}`, retailer: "web", merchant: domain.replace(/^www\./, ""), merchantDomain: domain,
      seller: typeof (offer?.seller as LD | undefined)?.name === "string" ? String((offer!.seller as LD).name) : null,
      productId: String(product.sku ?? product.gtin13 ?? product.mpn ?? ""), title: dec(String(product.name ?? "")) ?? "", brand: typeof brand === "string" ? brand : typeof brand?.name === "string" ? brand.name : null,
      image: imgs[0] ?? null, images: imgs, url, currency: String(offer?.priceCurrency ?? agg?.priceCurrency ?? "USD"), price: Number.isFinite(price) && price > 0 ? price : null, compareAtPrice: null,
      shipping: null, tax: null, inStock: avail ? /InStock|LimitedAvailability|PreOrder/i.test(avail) : null,
      specs: Object.fromEntries([["GTIN", String(product.gtin13 ?? product.gtin12 ?? "")], ["MPN", String(product.mpn ?? "")], ["Condition", String(offer?.itemCondition ?? "").replace(/^.*\//, "")]].filter(([, v]) => v && v !== "undefined")),
      source: "Page product data (schema.org)", fetchedAt: Date.now(),
    };
  }
  const title = dec(meta("og:title"));
  const amount = Number(meta("product:price:amount") ?? meta("og:price:amount"));
  if (!title) return null;
  return {
    id: `web:${domain}:${url}`, retailer: "web", merchant: domain.replace(/^www\./, ""), merchantDomain: domain, seller: null, productId: "", title, brand: null,
    image: meta("og:image") ?? null, images: meta("og:image") ? [meta("og:image")!] : [], url, currency: meta("product:price:currency") ?? "USD",
    price: Number.isFinite(amount) && amount > 0 ? amount : null, compareAtPrice: null, shipping: null, tax: null, inStock: null, specs: {}, source: "Page tags (Open Graph)", fetchedAt: Date.now(),
  };
}

export async function fetchProductPage(url: string, domain: string): Promise<{ offer: Offer | null; blocked?: string }> {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; BajarAgents/1.0; +https://www.sharebajar.com)", accept: "text/html" }, signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!r.ok) return { offer: null, blocked: `The store answered ${r.status}${r.status === 403 || r.status === 503 ? " (it blocks automated reads)" : ""}.` };
    const html = (await r.text()).slice(0, 2_000_000);
    const offer = parseProductHtml(html, url, domain);
    return offer ? { offer } : { offer: null, blocked: "The page doesn't publish product data Bajar can read." };
  } catch (e) {
    return { offer: null, blocked: `Couldn't reach the store (${String((e as Error).message).slice(0, 80)}).` };
  }
}

import "server-only";
import { fetchUpstream } from "@/lib/server/http";
import { cached } from "@/lib/server/cache";
import type { Offer } from "../types";

/**
 * Shopify storefront public data: search suggestions and `/products/<handle>.js`
 * (prices in cents, live availability). Read-only, no keys.
 */
interface SuggestProduct { title: string; handle: string; url: string; price: string; compare_at_price_max?: string; image?: string; vendor?: string; available?: boolean; id?: number }
interface ProductJs { id: number; title: string; handle: string; vendor: string; type?: string; description?: string; images: string[]; featured_image?: string; price: number; compare_at_price?: number | null; available: boolean; variants: { id: number; title: string; price: number; compare_at_price: number | null; available: boolean; sku?: string }[]; tags?: string[] }

const abs = (img: string | undefined | null) => (img ? (img.startsWith("//") ? `https:${img}` : img) : null);
const num = (s: string | number | null | undefined) => (s === null || s === undefined || s === "" ? null : Number(s));

export function fromProductJs(domain: string, store: string, p: ProductJs): Offer {
  const v = p.variants.find((x) => x.available) ?? p.variants[0];
  const price = (v?.price ?? p.price) / 100;
  const cmp = v?.compare_at_price ?? p.compare_at_price ?? null;
  return {
    id: `shopify:${domain}:${p.id}`, retailer: "shopify", merchant: store, merchantDomain: domain, seller: null, productId: String(p.id),
    title: p.title, brand: p.vendor || null, image: abs(p.featured_image ?? p.images?.[0]), images: (p.images ?? []).slice(0, 6).map((x) => abs(x)!).filter(Boolean),
    url: `https://${domain}/products/${p.handle}`, currency: "USD", price, compareAtPrice: cmp && cmp / 100 > price ? cmp / 100 : null,
    shipping: null, tax: null, inStock: p.available,
    specs: Object.fromEntries([["Type", p.type ?? ""], ["Variant", v?.title && v.title !== "Default Title" ? v.title : ""], ["SKU", v?.sku ?? ""]].filter(([, x]) => x)),
    source: "Shopify storefront data", fetchedAt: Date.now(),
  };
}

export async function shopifyProduct(domain: string, store: string, handle: string): Promise<Offer | null> {
  const env = await cached(`shopify:p:${domain}:${handle}`, "Shopify", { ttlMs: 60_000, staleMs: 10 * 60_000 }, () => fetchUpstream<ProductJs>(`https://${domain}/products/${encodeURIComponent(handle)}.js`, { timeoutMs: 7000, retries: 1 }));
  return env.data?.id ? fromProductJs(domain, store, env.data) : null;
}

export async function shopifySearch(domain: string, store: string, q: string, limit = 4): Promise<Offer[]> {
  const env = await cached(`shopify:s:${domain}:${q}:${limit}`, "Shopify", { ttlMs: 5 * 60_000, staleMs: 30 * 60_000 }, () =>
    fetchUpstream<{ resources?: { results?: { products?: SuggestProduct[] } } }>(`https://${domain}/search/suggest.json?q=${encodeURIComponent(q)}&resources%5Btype%5D=product&resources%5Blimit%5D=${limit}`, { timeoutMs: 7000, retries: 0 }));
  const items = env.data.resources?.results?.products ?? [];
  return items.map((p) => {
    const price = num(p.price);
    const cmp = num(p.compare_at_price_max);
    return {
      id: `shopify:${domain}:${p.id ?? p.handle}`, retailer: "shopify", merchant: store, merchantDomain: domain, seller: null, productId: String(p.id ?? p.handle),
      title: p.title, brand: p.vendor ?? null, image: abs(p.image), images: p.image ? [abs(p.image)!] : [], url: `https://${domain}/products/${p.handle}`,
      currency: "USD", price, compareAtPrice: cmp && price && cmp > price ? cmp : null, shipping: null, tax: null, inStock: p.available ?? null, specs: {},
      source: "Shopify storefront search", fetchedAt: Date.now(),
    } satisfies Offer;
  });
}

import "server-only";
import { fetchUpstream } from "@/lib/server/http";
import { cached } from "@/lib/server/cache";
import type { Offer } from "../types";

/* eBay Browse API (client-credentials). Enabled with EBAY_CLIENT_ID / EBAY_CLIENT_SECRET. */
let ebayToken: { value: string; exp: number } | null = null;
async function ebayAuth(): Promise<string> {
  if (ebayToken && ebayToken.exp > Date.now() + 60_000) return ebayToken.value;
  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", { method: "POST", headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope", signal: AbortSignal.timeout(8000) });
  const b = await r.json() as { access_token?: string; expires_in?: number };
  if (!b.access_token) throw new Error("eBay auth failed");
  ebayToken = { value: b.access_token, exp: Date.now() + (b.expires_in ?? 3600) * 1000 };
  return ebayToken.value;
}
interface EbayItem { itemId: string; legacyItemId?: string; title: string; price?: { value: string; currency: string }; image?: { imageUrl: string }; itemWebUrl: string; seller?: { username: string; feedbackPercentage?: string }; shippingOptions?: { shippingCost?: { value: string } }[]; condition?: string; brand?: string; marketingPrice?: { originalPrice?: { value: string } } }
const fromEbay = (i: EbayItem): Offer => ({
  id: `ebay:${i.legacyItemId ?? i.itemId}`, retailer: "ebay", merchant: "eBay", merchantDomain: "www.ebay.com", seller: i.seller?.username ? `${i.seller.username}${i.seller.feedbackPercentage ? ` (${i.seller.feedbackPercentage}% positive)` : ""}` : null,
  productId: i.legacyItemId ?? i.itemId, title: i.title, brand: i.brand ?? null, image: i.image?.imageUrl ?? null, images: i.image ? [i.image.imageUrl] : [], url: i.itemWebUrl,
  currency: i.price?.currency ?? "USD", price: i.price ? Number(i.price.value) : null, compareAtPrice: i.marketingPrice?.originalPrice ? Number(i.marketingPrice.originalPrice.value) : null,
  shipping: i.shippingOptions?.[0]?.shippingCost ? Number(i.shippingOptions[0].shippingCost.value) : null, tax: null, inStock: true, specs: i.condition ? { Condition: i.condition } : {}, source: "eBay Browse API", fetchedAt: Date.now(),
});
export const ebayEnabled = () => !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
export async function ebaySearch(q: string, limit = 6, maxPrice?: number): Promise<Offer[]> {
  if (!ebayEnabled()) return [];
  const env = await cached(`ebay:s:${q}:${limit}:${maxPrice ?? ""}`, "eBay", { ttlMs: 5 * 60_000 }, async () => {
    const filter = maxPrice ? `&filter=price:[..${maxPrice}],priceCurrency:USD` : "";
    return fetchUpstream<{ itemSummaries?: EbayItem[] }>(`https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}${filter}`, { headers: { authorization: `Bearer ${await ebayAuth()}`, "x-ebay-c-marketplace-id": "EBAY_US" } });
  });
  return (env.data.itemSummaries ?? []).map(fromEbay);
}
export async function ebayItem(legacyId: string): Promise<Offer | null> {
  if (!ebayEnabled()) return null;
  const i = await fetchUpstream<EbayItem>(`https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(legacyId)}`, { headers: { authorization: `Bearer ${await ebayAuth()}`, "x-ebay-c-marketplace-id": "EBAY_US" } });
  return i?.itemId ? fromEbay(i) : null;
}

/* Best Buy Products API. Enabled with BESTBUY_API_KEY. */
interface BbyProduct { sku: number; name: string; salePrice: number; regularPrice: number; url: string; image?: string; manufacturer?: string; onlineAvailability?: boolean; freeShipping?: boolean; shippingCost?: number | string; modelNumber?: string }
const fromBby = (p: BbyProduct): Offer => ({
  id: `bestbuy:${p.sku}`, retailer: "bestbuy", merchant: "Best Buy", merchantDomain: "www.bestbuy.com", seller: null, productId: String(p.sku), title: p.name, brand: p.manufacturer ?? null,
  image: p.image ?? null, images: p.image ? [p.image] : [], url: p.url, currency: "USD", price: p.salePrice, compareAtPrice: p.regularPrice > p.salePrice ? p.regularPrice : null,
  shipping: p.freeShipping ? 0 : typeof p.shippingCost === "number" ? p.shippingCost : null, tax: null, inStock: p.onlineAvailability ?? null, specs: p.modelNumber ? { Model: p.modelNumber } : {}, source: "Best Buy API", fetchedAt: Date.now(),
});
export const bestbuyEnabled = () => !!process.env.BESTBUY_API_KEY;
const BBY_SHOW = "sku,name,salePrice,regularPrice,url,image,manufacturer,onlineAvailability,freeShipping,shippingCost,modelNumber";
export async function bestbuySearch(q: string, limit = 6, maxPrice?: number): Promise<Offer[]> {
  if (!bestbuyEnabled()) return [];
  const terms = q.split(/\s+/).filter((w) => /^[\w-]{2,}$/.test(w)).slice(0, 6).map((w) => `search=${encodeURIComponent(w)}`).join("&");
  if (!terms) return [];
  const price = maxPrice ? `&salePrice<=${maxPrice}` : "";
  const env = await cached(`bby:s:${q}:${limit}:${maxPrice ?? ""}`, "Best Buy", { ttlMs: 5 * 60_000 }, () =>
    fetchUpstream<{ products?: BbyProduct[] }>(`https://api.bestbuy.com/v1/products(${terms}${price})?apiKey=${process.env.BESTBUY_API_KEY}&format=json&pageSize=${limit}&show=${BBY_SHOW}`));
  return (env.data.products ?? []).map(fromBby);
}
export async function bestbuyItem(sku: string): Promise<Offer | null> {
  if (!bestbuyEnabled() || !/^\d+$/.test(sku)) return null;
  const env = await fetchUpstream<{ products?: BbyProduct[] }>(`https://api.bestbuy.com/v1/products(sku=${sku})?apiKey=${process.env.BESTBUY_API_KEY}&format=json&show=${BBY_SHOW}`);
  return env.products?.[0] ? fromBby(env.products[0]) : null;
}

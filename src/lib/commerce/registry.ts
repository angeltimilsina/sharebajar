import "server-only";
import type { Retailer } from "./types";

/**
 * Retailer capability registry. Capabilities reflect what is integrated and
 * configured right now — never what a retailer could theoretically support.
 */
export function retailers(): Retailer[] {
  const ebay = !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
  const bestbuy = !!process.env.BESTBUY_API_KEY;
  return [
    { id: "bajar-sandbox", name: "Bajar Test Store (sandbox)", domains: ["sandbox.sharebajar.com"], capabilities: ["discovery", "price", "inventory", "cart", "checkout", "crypto", "tracking"], checkout: "bajar_pay_sandbox", note: "Test merchant for trying BAJAR Pay end to end. Sandbox orders move no money and ship nothing." },
    { id: "shopify", name: "Shopify merchants", domains: [], capabilities: ["discovery", "price", "inventory"], checkout: "external", note: "Live prices and stock from the store's public storefront data. Checkout happens on the merchant's site." },
    { id: "amazon", name: "Amazon", domains: ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.ca", "amazon.in", "amzn.to"], capabilities: [], checkout: "external", note: "Link recognized. Live pricing needs Amazon Product Advertising API access (not configured)." },
    { id: "walmart", name: "Walmart", domains: ["walmart.com"], capabilities: [], checkout: "external", note: "Link recognized. Live pricing needs Walmart's affiliate API (not configured)." },
    { id: "ebay", name: "eBay", domains: ["ebay.com", "ebay.co.uk", "ebay.de"], capabilities: ebay ? ["discovery", "price", "inventory"] : [], checkout: "external", note: ebay ? "Live listings from the eBay Browse API." : "Link recognized. Set EBAY_CLIENT_ID / EBAY_CLIENT_SECRET for live listings." },
    { id: "bestbuy", name: "Best Buy", domains: ["bestbuy.com"], capabilities: bestbuy ? ["discovery", "price", "inventory"] : [], checkout: "external", note: bestbuy ? "Live products from the Best Buy API." : "Link recognized. Set BESTBUY_API_KEY for live products." },
    { id: "target", name: "Target", domains: ["target.com"], capabilities: [], checkout: "external", note: "Link recognized. No public product API." },
    { id: "web", name: "Other stores", domains: [], capabilities: ["price"], checkout: "external", note: "Reads the product data the page publishes (schema.org), when the site allows it." },
  ];
}

export const retailerById = (id: string) => retailers().find((r) => r.id === id) ?? retailers().find((r) => r.id === "web")!;

/**
 * Shopify stores Bajar searches for #Find (verified storefronts; public
 * product data only). Extend with SHOPIFY_STORES=domain1,domain2.
 */
export function shopifyStores(): { domain: string; name: string }[] {
  const base = [
    { domain: "www.allbirds.com", name: "Allbirds" },
    { domain: "ridge.com", name: "Ridge" },
    { domain: "nomadgoods.com", name: "Nomad" },
    { domain: "www.peakdesign.com", name: "Peak Design" },
    { domain: "www.brooklinen.com", name: "Brooklinen" },
    { domain: "bombas.com", name: "Bombas" },
    { domain: "www.gymshark.com", name: "Gymshark" },
    { domain: "www.skullcandy.com", name: "Skullcandy" },
    { domain: "www.casetify.com", name: "CASETiFY" },
    { domain: "www.away.com", name: "Away" },
  ];
  const extra = (process.env.SHOPIFY_STORES ?? "").split(",").map((d) => d.trim()).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)).map((d) => ({ domain: d, name: d.replace(/^www\./, "") }));
  return [...base, ...extra];
}

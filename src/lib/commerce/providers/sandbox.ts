import type { Offer } from "../types";

/**
 * Bajar Test Store: a sandbox merchant for exercising BAJAR Pay end to end
 * (quote → wallet authorization → order → tracking → refund). Every item is
 * marked TEST; sandbox orders move no money and nothing ships.
 */
const ITEMS: [string, string, number, number | null, string, Record<string, string>][] = [
  ["tst-hp1", "TEST · Wireless Noise-Cancelling Headphones", 199, 249, "Audio", { Battery: "30 h", Connectivity: "Bluetooth 5.3" }],
  ["tst-lp1", "TEST · 13-inch Laptop, 16 GB RAM", 899, 999, "Computers", { RAM: "16 GB", Storage: "512 GB SSD" }],
  ["tst-ph1", "TEST · Smartphone 256 GB", 749, null, "Phones", { Storage: "256 GB", Display: "6.1-inch" }],
  ["tst-sn1", "TEST · Running Sneakers", 120, 140, "Shoes", { Size: "US 9" }],
  ["tst-wt1", "TEST · Smart Watch", 249, null, "Wearables", { Case: "44 mm" }],
  // Exercises the merchant-confirmation-failure path: the test merchant never confirms this order.
  ["tst-fail", "TEST · Merchant-offline item (confirmation fails)", 25, null, "Test cases", { Scenario: "Merchant does not confirm" }],
];
export const SANDBOX_FAIL_ID = "tst-fail";
export const SANDBOX_SHIPPING = [
  { id: "std", label: "Standard (5–7 days)", usd: 0, days: [5, 7] },
  { id: "exp", label: "Express (2–3 days)", usd: 12, days: [2, 3] },
];
export function sandboxCatalog(): Offer[] {
  return ITEMS.map(([id, title, price, cmp, type, specs]) => ({
    id: `bajar-sandbox:${id}`, retailer: "bajar-sandbox", merchant: "Bajar Test Store", merchantDomain: "sandbox.sharebajar.com", seller: null, productId: id, title, brand: "Bajar Test",
    image: null, images: [], url: `https://www.sharebajar.com/agents?sandbox=1&product=${id}`, currency: "USD", price, compareAtPrice: cmp, shipping: 0, tax: 0, inStock: true,
    specs: { Type: type, ...specs }, source: "Sandbox catalog (test data)", fetchedAt: Date.now(), sandbox: true,
  }));
}
export const sandboxItem = (id: string) => sandboxCatalog().find((o) => o.productId === id || o.id === id) ?? null;
export function sandboxSearch(q: string, maxPrice?: number): Offer[] {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return sandboxCatalog().filter((o) => (!words.length || words.some((w) => o.title.toLowerCase().includes(w) || (o.specs.Type ?? "").toLowerCase().includes(w))) && (maxPrice === undefined || (o.price ?? 0) <= maxPrice));
}

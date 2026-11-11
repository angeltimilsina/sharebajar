/** Unified product listing used by every provider and agent. Nothing here is ever invented: unknown = null. */
export interface Offer {
  id: string;                 // `${retailer}:${productId}:${variantId?}`
  retailer: string;           // registry id
  merchant: string;           // store / seller display name
  merchantDomain: string;
  seller: string | null;      // marketplace seller, when different from the merchant
  productId: string;
  title: string;
  brand: string | null;
  image: string | null;
  images: string[];
  url: string;                // canonical product URL
  currency: string;
  price: number | null;
  compareAtPrice: number | null;   // merchant's own "was" price (a real discount signal)
  shipping: number | null;         // null = shown by the merchant at checkout
  tax: number | null;              // null = calculated at checkout
  inStock: boolean | null;
  specs: Record<string, string>;
  source: string;             // where the data came from (API / feed / page data)
  fetchedAt: number;
  sandbox?: boolean;
}

export type Capability = "discovery" | "price" | "inventory" | "cart" | "checkout" | "crypto" | "tracking";

export interface Retailer {
  id: string;
  name: string;
  domains: string[];
  /** What Bajar can actually do with this retailer right now (depends on configured integrations). */
  capabilities: Capability[];
  /** How a user completes a purchase. */
  checkout: "bajar_pay" | "bajar_pay_sandbox" | "external";
  note: string;
}

export interface AgentEvent {
  type: "agent";
  agent: AgentId;
  status: "working" | "done" | "skipped" | "error";
  label: string;
  tool?: string;
  findings?: string[];
  confidence?: number;        // 0..1
}
export type AgentId = "find" | "deals" | "compare" | "verify" | "shipping" | "budget" | "crypto" | "checkout" | "track";
export const AGENTS: { id: AgentId; tag: string; role: string }[] = [
  { id: "find", tag: "#Find", role: "Discover products across retailers" },
  { id: "deals", tag: "#Deals", role: "Identify discounts and promotions" },
  { id: "compare", tag: "#Compare", role: "Compare prices, specs and sellers" },
  { id: "verify", tag: "#Verify", role: "Check merchant legitimacy" },
  { id: "shipping", tag: "#Shipping", role: "Delivery options and arrival" },
  { id: "budget", tag: "#Budget", role: "Best picks within a spending limit" },
  { id: "crypto", tag: "#Crypto", role: "Crypto conversion and payment costs" },
  { id: "checkout", tag: "#Checkout", role: "Prepare an authorized purchase" },
  { id: "track", tag: "#Track", role: "Orders, delivery and refunds" },
];

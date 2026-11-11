import { shopifyStoresClient } from "./storesClient";

/**
 * Product-link recognition and anti-phishing checks. Pure functions (shared
 * by server and browser).
 */
const KNOWN: Record<string, string> = {
  "amazon.com": "amazon", "amazon.co.uk": "amazon", "amazon.de": "amazon", "amazon.ca": "amazon", "amazon.in": "amazon", "amzn.to": "amazon", "a.co": "amazon",
  "walmart.com": "walmart", "ebay.com": "ebay", "ebay.co.uk": "ebay", "ebay.de": "ebay", "bestbuy.com": "bestbuy", "target.com": "target",
};
const BRANDS = ["amazon", "walmart", "ebay", "bestbuy", "target", "shopify", "apple", "paypal"];

export interface ParsedLink { ok: boolean; url?: string; host?: string; retailer?: string; productId?: string | null; warnings: string[]; blocked?: string }

const registrable = (host: string) => host.replace(/^www\./, "").split(".").slice(-3).join(".").replace(/^(?:smile|m|www2)\./, "");
function baseDomain(host: string) {
  const h = host.replace(/^www\./, "");
  for (const k of Object.keys(KNOWN)) if (h === k || h.endsWith(`.${k}`)) return k;
  return registrable(h);
}

/** Levenshtein distance (small strings). */
function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function parseProductLink(input: string): ParsedLink {
  const warnings: string[] = [];
  let u: URL;
  try { u = new URL(input.trim()); } catch { return { ok: false, warnings, blocked: "That isn't a valid link." }; }
  if (u.protocol !== "https:") return { ok: false, warnings, blocked: "Only https:// links are accepted." };
  const host = u.hostname.toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes("[") || host === "localhost") return { ok: false, warnings, blocked: "Links to IP addresses or local hosts aren't accepted." };
  if (host.startsWith("xn--") || host.includes(".xn--")) return { ok: false, warnings, blocked: "Internationalized (punycode) domains are blocked: they're often used to imitate real stores." };
  if (u.username || u.password) return { ok: false, warnings, blocked: "Links with embedded credentials are blocked." };
  const base = baseDomain(host);
  const retailer = KNOWN[base] ?? (shopifyStoresClient().some((s) => s.replace(/^www\./, "") === host.replace(/^www\./, "")) ? "shopify" : undefined);
  // Lookalikes: "arnazon.com", "amazon-deals.shop", "walmart.secure-pay.top"…
  if (!KNOWN[base]) {
    const label = base.split(".")[0];
    for (const b of BRANDS) {
      if (label !== b && (label.includes(b) || lev(label, b) <= 2) && label.length >= 4) return { ok: false, warnings, blocked: `This domain (${base}) imitates ${b}. It isn't the official store.` };
    }
  }
  let productId: string | null = null;
  const p = u.pathname;
  if (KNOWN[base] === "amazon") productId = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i.exec(p)?.[1]?.toUpperCase() ?? null;
  else if (KNOWN[base] === "walmart") productId = /\/ip\/(?:[^/]+\/)?(\d{5,})/.exec(p)?.[1] ?? null;
  else if (KNOWN[base] === "ebay") productId = /\/itm\/(?:[^/]+\/)?(\d{9,})/.exec(p)?.[1] ?? null;
  else if (KNOWN[base] === "bestbuy") productId = /\/(\d{6,8})\.p/.exec(p)?.[1] ?? u.searchParams.get("skuId");
  else if (KNOWN[base] === "target") productId = /\/A-(\d+)/.exec(p)?.[1] ?? null;
  else if (/\/products\/[^/?#]+/.test(p)) productId = /\/products\/([^/?#]+)/.exec(p)![1];
  if (!retailer) warnings.push("Unknown store: Bajar will read the page's product data if it publishes it, but can't vouch for the merchant.");
  return { ok: true, url: `${u.origin}${u.pathname}`, host, retailer: retailer ?? "web", productId, warnings };
}

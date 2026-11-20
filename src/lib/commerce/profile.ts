import "server-only";
import { q } from "@/lib/treasury/db";
import { decrypt, encrypt } from "@/lib/treasury/crypto";

/**
 * Shopping profile: the details a checkout needs (name, email, phone,
 * addresses). Stored encrypted (AES-256-GCM) per Bajar profile, readable only
 * by its signed-in owner. Agents clone it into checkouts; it is shared with a
 * merchant only when the customer confirms that checkout.
 */
export interface Address { id: string; label: string; name: string; line1: string; line2?: string; city: string; region?: string; postal: string; country: string; phone?: string }
/** Agentic billing: how agents prepare payments for you. Every payment still needs your wallet signature. */
export interface BillingPrefs { asset: "USDC" | "USDT" | "ETH" | "SOL"; network: string | null; agentLimitUsd: number | null }
export interface ShoppingProfile { name: string; email: string; phone: string; addresses: Address[]; defaultAddress: string | null; billingSameAsShipping: boolean; billing: Address | null; payment: BillingPrefs }

export const EMPTY_PROFILE: ShoppingProfile = { name: "", email: "", phone: "", addresses: [], defaultAddress: null, billingSameAsShipping: true, billing: null, payment: { asset: "USDC", network: null, agentLimitUsd: null } };

const t = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, n) : "");

export class ProfileError extends Error {}

/** Validates and normalizes user input. Throws ProfileError with a readable message. */
export function cleanProfile(input: unknown): ShoppingProfile {
  const i = (input ?? {}) as Record<string, unknown>;
  const email = t(i.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ProfileError("That email doesn't look right.");
  const phone = t(i.phone, 30);
  if (phone && !/^[+\d][\d\s().-]{5,}$/.test(phone)) throw new ProfileError("That phone number doesn't look right.");
  const raw = Array.isArray(i.addresses) ? i.addresses.slice(0, 10) : [];
  const addresses: Address[] = raw.map((a, n) => cleanAddress(a, n));
  const def = typeof i.defaultAddress === "string" && addresses.some((a) => a.id === i.defaultAddress) ? i.defaultAddress : addresses[0]?.id ?? null;
  const same = i.billingSameAsShipping !== false;
  const billing = !same && i.billing ? cleanAddress({ ...(i.billing as object), label: "Billing", id: "billing" }, 0) : null;
  const pay = (i.payment ?? {}) as Record<string, unknown>;
  const asset = (["USDC", "USDT", "ETH", "SOL"] as const).find((a) => a === pay.asset) ?? "USDC";
  const network = typeof pay.network === "string" && /^(solana|ethereum|base)$/.test(pay.network) ? pay.network : null;
  const lim = pay.agentLimitUsd === null || pay.agentLimitUsd === undefined || pay.agentLimitUsd === "" ? null : Number(pay.agentLimitUsd);
  if (lim !== null && !(Number.isFinite(lim) && lim >= 1 && lim <= 100_000)) throw new ProfileError("Agent spending limit must be between $1 and $100,000, or empty for no limit.");
  return { name: t(i.name, 80), email, phone, addresses, defaultAddress: def, billingSameAsShipping: same, billing, payment: { asset, network, agentLimitUsd: lim === null ? null : Math.round(lim * 100) / 100 } };
}

function cleanAddress(a: unknown, n: number): Address {
    const x = (a ?? {}) as Record<string, unknown>;
    const ad: Address = {
      id: /^[a-z0-9]{1,16}$/.test(String(x.id ?? "")) ? String(x.id) : `a${n}${Math.random().toString(36).slice(2, 8)}`,
      label: t(x.label, 30) || "Home", name: t(x.name, 80), line1: t(x.line1, 120), line2: t(x.line2, 120) || undefined, city: t(x.city, 60),
      region: t(x.region, 60) || undefined, postal: t(x.postal, 20), country: t(x.country, 2).toUpperCase(), phone: t(x.phone, 30) || undefined,
    };
    if (!ad.name || !ad.line1 || !ad.city || !ad.postal || !/^[A-Z]{2}$/.test(ad.country)) throw new ProfileError(`Address "${ad.label}" needs a name, street, city, postal code and 2-letter country.`);
    return ad;
}

export async function getShoppingProfile(profileId: string): Promise<ShoppingProfile> {
  const row = (await q<{ data_enc: string }>("select data_enc from shopping_profiles where profile_id=$1", [profileId]))[0];
  if (!row) return { ...EMPTY_PROFILE };
  try { const d = decrypt<ShoppingProfile>(row.data_enc) ?? EMPTY_PROFILE; return { ...EMPTY_PROFILE, ...d, payment: { ...EMPTY_PROFILE.payment, ...(d.payment ?? {}) } }; } catch { return { ...EMPTY_PROFILE }; }
}

export async function saveShoppingProfile(profileId: string, p: ShoppingProfile) {
  await q("insert into shopping_profiles (profile_id, data_enc, updated_at) values ($1,$2,now()) on conflict (profile_id) do update set data_enc=excluded.data_enc, updated_at=now()", [profileId, encrypt(p)]);
}

export async function deleteShoppingProfile(profileId: string) {
  await q("delete from shopping_profiles where profile_id=$1", [profileId]);
}

export const defaultAddress = (p: ShoppingProfile) => p.addresses.find((a) => a.id === p.defaultAddress) ?? p.addresses[0] ?? null;

/**
 * Shopify cart permalink with checkout prefill (Shopify's documented
 * checkout[email] / checkout[shipping_address][…] parameters). The customer
 * lands on the merchant's own checkout with their details filled in and pays there.
 */
export function shopifyPrefillUrl(domain: string, variantId: number | string, qty: number, p: ShoppingProfile, a: Address | null): string {
  const u = new URL(`https://${domain}/cart/${encodeURIComponent(String(variantId))}:${Math.max(1, Math.min(10, Math.trunc(qty)))}`);
  const set = (k: string, v: string | undefined) => { if (v) u.searchParams.set(k, v); };
  set("checkout[email]", p.email);
  if (a) {
    const [first, ...rest] = a.name.split(/\s+/);
    set("checkout[shipping_address][first_name]", first);
    set("checkout[shipping_address][last_name]", rest.join(" "));
    set("checkout[shipping_address][address1]", a.line1);
    set("checkout[shipping_address][address2]", a.line2);
    set("checkout[shipping_address][city]", a.city);
    set("checkout[shipping_address][province]", a.region);
    set("checkout[shipping_address][zip]", a.postal);
    set("checkout[shipping_address][country]", a.country);
    set("checkout[shipping_address][phone]", a.phone || p.phone);
  }
  return u.toString();
}

/* ------------------------------------------------------------------ */
/* Store accounts: agents sign in to stores only through official OAuth. */
/* Store passwords are never requested or stored.                       */
/* ------------------------------------------------------------------ */

export interface StoreConnector {
  id: "amazon" | "ebay";
  name: string;
  configured: boolean;
  missing: string[];
  /** What connecting gives the agents. */
  grants: string[];
  authorizeUrl(state: string, redirectUri: string): string;
}

export function storeConnectors(): StoreConnector[] {
  const amazonMissing = ["AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET"].filter((k) => !process.env[k]);
  const ebayMissing = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME"].filter((k) => !process.env[k]);
  return [
    {
      id: "amazon", name: "Amazon", configured: !amazonMissing.length, missing: amazonMissing,
      grants: ["Sign in with your Amazon account (Login with Amazon)", "Clone your name, email and postal code into your Bajar profile"],
      authorizeUrl: (state, redirectUri) => `https://www.amazon.com/ap/oa?${new URLSearchParams({ client_id: process.env.AMAZON_LWA_CLIENT_ID ?? "", scope: "profile postal_code", response_type: "code", redirect_uri: redirectUri, state })}`,
    },
    {
      id: "ebay", name: "eBay", configured: !ebayMissing.length, missing: ebayMissing,
      grants: ["Sign in with your eBay account (eBay OAuth)", "Agents know which eBay account is yours when comparing listings"],
      // eBay uses the RuName in place of a redirect URL; the RuName's accept URL points at /api/stores/callback/ebay.
      authorizeUrl: (state) => `https://auth.ebay.com/oauth2/authorize?${new URLSearchParams({ client_id: process.env.EBAY_CLIENT_ID ?? "", redirect_uri: process.env.EBAY_RUNAME ?? "", response_type: "code", scope: "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly", state })}`,
    },
  ];
}
export const connectorById = (id: string) => storeConnectors().find((c) => c.id === id) ?? null;

export interface StoreLogin { accountName: string | null; token: { refresh?: string; access?: string; expiresAt?: number } | null; scopes: string; profileImport?: Partial<{ name: string; email: string; postal: string }> }

async function postForm<T>(url: string, body: Record<string, string>, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body), signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Token exchange failed (${r.status})`);
  return j as T;
}

/** Exchanges the OAuth code and reads the account identity. */
export async function completeStoreLogin(store: "amazon" | "ebay", code: string, redirectUri: string): Promise<StoreLogin> {
  if (store === "amazon") {
    const tok = await postForm<{ access_token: string; refresh_token?: string; expires_in?: number }>("https://api.amazon.com/auth/o2/token", {
      grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: process.env.AMAZON_LWA_CLIENT_ID ?? "", client_secret: process.env.AMAZON_LWA_CLIENT_SECRET ?? "",
    });
    const r = await fetch("https://api.amazon.com/user/profile", { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`Amazon profile unavailable (${r.status})`);
    const p = (await r.json()) as { name?: string; email?: string; postal_code?: string };
    // Only the identity is kept: Amazon offers no public API for agents to order, so its tokens aren't stored.
    return { accountName: p.email ?? p.name ?? null, token: null, scopes: "profile postal_code", profileImport: { name: p.name, email: p.email, postal: p.postal_code } };
  }
  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
  const tok = await postForm<{ access_token: string; refresh_token?: string; expires_in?: number }>("https://api.ebay.com/identity/v1/oauth2/token", {
    grant_type: "authorization_code", code, redirect_uri: process.env.EBAY_RUNAME ?? "",
  }, { authorization: `Basic ${basic}` });
  const r = await fetch("https://apiz.ebay.com/commerce/identity/v1/user/", { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`eBay account unavailable (${r.status})`);
  const u = (await r.json()) as { username?: string };
  return { accountName: u.username ?? null, token: { refresh: tok.refresh_token, access: tok.access_token, expiresAt: Date.now() + (tok.expires_in ?? 7200) * 1000 }, scopes: "commerce.identity.readonly" };
}

export async function saveStoreAccount(profileId: string, store: string, l: StoreLogin) {
  await q(`insert into store_accounts (profile_id, store, account_name, token_enc, scopes, connected_at) values ($1,$2,$3,$4,$5,now())
    on conflict (profile_id, store) do update set account_name=excluded.account_name, token_enc=excluded.token_enc, scopes=excluded.scopes, connected_at=now()`,
    [profileId, store, l.accountName, l.token ? encrypt(l.token) : null, l.scopes]);
}

export async function storeAccounts(profileId: string): Promise<{ store: string; accountName: string | null; scopes: string | null; connectedAt: string }[]> {
  const rows = await q<{ store: string; account_name: string | null; scopes: string | null; connected_at: string | Date }>("select store, account_name, scopes, connected_at from store_accounts where profile_id=$1 order by store", [profileId]);
  return rows.map((r) => ({ store: r.store, accountName: r.account_name, scopes: r.scopes, connectedAt: new Date(r.connected_at).toISOString() }));
}

export async function disconnectStore(profileId: string, store: string) {
  await q("delete from store_accounts where profile_id=$1 and store=$2", [profileId, store]);
}

/** Merges a store's identity into the shopping profile without overwriting what the user already entered. */
export function mergeImport(p: ShoppingProfile, imp: StoreLogin["profileImport"]): ShoppingProfile {
  if (!imp) return p;
  return { ...p, name: p.name || t(imp.name, 80), email: p.email || t(imp.email, 120) };
}

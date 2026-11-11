import { beforeAll, describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { parseProductLink } from "@/lib/commerce/url";
import { parseProductHtml } from "@/lib/commerce/providers/jsonld";
import { fromProductJs } from "@/lib/commerce/providers/shopify";

describe("product links + anti-phishing", () => {
  it("recognizes retailer links and extracts product ids", () => {
    expect(parseProductLink("https://www.amazon.com/Some-Thing/dp/B0CHX1W1XY?ref=x")).toMatchObject({ ok: true, retailer: "amazon", productId: "B0CHX1W1XY" });
    expect(parseProductLink("https://www.walmart.com/ip/Thing/123456789")).toMatchObject({ ok: true, retailer: "walmart", productId: "123456789" });
    expect(parseProductLink("https://www.ebay.com/itm/1234567890")).toMatchObject({ ok: true, retailer: "ebay", productId: "1234567890" });
    expect(parseProductLink("https://www.allbirds.com/products/mens-tree-runners")).toMatchObject({ ok: true, retailer: "shopify", productId: "mens-tree-runners" });
  });
  it("blocks phishing patterns", () => {
    expect(parseProductLink("http://www.amazon.com/dp/B0CHX1W1XY").blocked).toMatch(/https/);
    expect(parseProductLink("https://arnazon.com/dp/B0CHX1W1XY").blocked).toMatch(/imitates amazon/);
    expect(parseProductLink("https://amazon-deals.shop/x").blocked).toMatch(/imitates amazon/);
    expect(parseProductLink("https://xn--amazn-mye.com/").blocked).toMatch(/punycode/);
    expect(parseProductLink("https://user:pw@amazon.com/").blocked).toMatch(/credentials/);
    expect(parseProductLink("https://127.0.0.1/products/x").blocked).toMatch(/IP/);
  });
  it("warns on unknown stores", () => {
    const r = parseProductLink("https://shop.example.org/products/thing");
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/Unknown store/);
  });
});

describe("product data parsing", () => {
  it("reads schema.org Product JSON-LD and never invents missing fields", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Desk Lamp", brand: { name: "Lumo" }, image: "https://cdn.example.org/l.jpg", offers: { "@type": "Offer", price: "49.90", priceCurrency: "USD", availability: "https://schema.org/InStock" } })}</script></head></html>`;
    const o = parseProductHtml(html, "https://shop.example.org/p/lamp", "shop.example.org")!;
    expect(o).toMatchObject({ title: "Desk Lamp", price: 49.9, inStock: true, brand: "Lumo", shipping: null, tax: null, compareAtPrice: null });
  });
  it("maps Shopify product data (cents) and keeps compare-at only when it's a real discount", () => {
    const o = fromProductJs("ridge.com", "Ridge", { id: 1, title: "Wallet", handle: "wallet", vendor: "Ridge", type: "Wallets", price: 9500, compare_at_price: 12000, available: true, featured_image: "//cdn.shopify.com/a.jpg", images: [], variants: [{ id: 2, title: "Default Title", price: 9500, compare_at_price: 12000, available: true, sku: "W1" }] } as never);
    expect(o).toMatchObject({ price: 95, compareAtPrice: 120, inStock: true, url: "https://ridge.com/products/wallet", shipping: null });
    const o2 = fromProductJs("ridge.com", "Ridge", { id: 1, title: "W", handle: "w", price: 9500, compare_at_price: 9500, available: true, images: [], variants: [] } as never);
    expect(o2.compareAtPrice).toBeNull();
  });
});

describe("agent request parsing", () => {
  it("parses hashtags, budget, asset and the query", async () => {
    const { parseRequest } = await import("@/lib/commerce/agents");
    const r = parseRequest("#Compare #Crypto wireless headphones under $250 pay with SOL");
    expect(r.tags).toEqual(["find", "compare", "crypto"]);
    expect(r.budget).toBe(250);
    expect(r.asset).toBe("SOL");
    expect(r.query).toBe("wireless headphones");
    const d = parseRequest("laptop");
    expect(d.tags).toContain("verify");
    expect(d.tags).toContain("checkout");
    expect(parseRequest("#Track").tags).toEqual(["track"]);
  });
});

describe("BAJAR Pay (sandbox)", () => {
  beforeAll(async () => { (await import("@/lib/treasury/db")).__useMemoryDb(); });
  const priv = ed25519.utils.randomPrivateKey();
  const wallet = bs58.encode(ed25519.getPublicKey(priv));
  const sign = (m: string) => bs58.encode(ed25519.sign(new TextEncoder().encode(m), priv));
  const ship = { name: "Test Buyer", line1: "1 Test St", city: "Austin", postal: "78701", country: "US" };
  const quote = async (offerId = "bajar-sandbox:tst-hp1", quantity = 1) => (await import("@/lib/commerce/orders")).createQuote({ offerId, quantity, asset: "USDC", wallet, chainType: "solana", host: "localhost" });

  it("quotes with itemized, disclosed fees and separate accounting", async () => {
    const q = await quote();
    expect(q.sandbox).toBe(true);
    expect(q.lines.map((l) => l.label)[0]).toBe("Item × 1");
    expect(q.bajarFeeUsd).toBe(1); // 0.5% of $199, rounded to cents
    expect(q.totalUsd).toBeCloseTo(199 + q.bajarFeeUsd, 2);
    expect(q.merchantSettlementUsd).toBeCloseTo(199 - q.commissionUsd, 2);
    expect(q.message).toContain(q.hash);
    expect(q.message).toContain("SANDBOX");
  });

  it("refuses merchants without a BAJAR Pay integration (external checkout)", async () => {
    const { PayError } = await import("@/lib/commerce/orders");
    await expect(quote("shopify:ridge.com:1")).rejects.toBeInstanceOf(PayError);
    await expect(quote("shopify:ridge.com:1")).rejects.toMatchObject({ code: "external_checkout" });
  });

  it("requires the wallet's signature over the exact quote, and is idempotent", async () => {
    const { authorizeOrder } = await import("@/lib/commerce/orders");
    const q = await quote();
    await expect(authorizeOrder({ quoteId: q.id, signature: sign(q.message + "x"), idempotencyKey: "k-bad-signature-0001", shipping: ship, consent: true, ipHash: "ip1" })).rejects.toMatchObject({ code: "signature" });
    await expect(authorizeOrder({ quoteId: q.id, signature: sign(q.message), idempotencyKey: "k-no-consent-000001", shipping: ship, consent: false, ipHash: "ip1" })).rejects.toMatchObject({ code: "consent" });
    const o = await authorizeOrder({ quoteId: q.id, signature: sign(q.message), idempotencyKey: "k-good-0000000001", shipping: ship, consent: true, ipHash: "ip1" });
    expect(o.status).toBe("confirmed");
    expect(o.sandbox).toBe(true);
    const again = await authorizeOrder({ quoteId: q.id, signature: sign(q.message), idempotencyKey: "k-good-0000000001", shipping: ship, consent: true, ipHash: "ip1" });
    expect(again.id).toBe(o.id);
    await expect(authorizeOrder({ quoteId: q.id, signature: sign(q.message), idempotencyKey: "k-other-000000001", shipping: ship, consent: true, ipHash: "ip1" })).rejects.toMatchObject({ code: "quote_used" });
  });

  it("rejects expired quotes", async () => {
    const { authorizeOrder } = await import("@/lib/commerce/orders");
    const { q: sql } = await import("@/lib/treasury/db");
    const q = await quote();
    await sql("update commerce_quotes set expires_at = now() - interval '1 minute' where id=$1", [q.id]);
    await expect(authorizeOrder({ quoteId: q.id, signature: sign(q.message), idempotencyKey: "k-expired-00000001", shipping: ship, consent: true, ipHash: "ip1" })).rejects.toMatchObject({ code: "quote_expired" });
  });

  it("reports merchant confirmation failure without charging", async () => {
    const { authorizeOrder } = await import("@/lib/commerce/orders");
    const q = await quote("bajar-sandbox:tst-fail");
    const o = await authorizeOrder({ quoteId: q.id, signature: sign(q.message), idempotencyKey: "k-fail-0000000001", shipping: ship, consent: true, ipHash: "ip1" });
    expect(o.status).toBe("merchant_failed");
    expect(o.events.at(-1)!.note).toMatch(/nothing was charged/);
  });

  it("blocks orders beyond sandbox test funds", async () => {
    const { authorizeOrder } = await import("@/lib/commerce/orders");
    const q = await quote("bajar-sandbox:tst-lp1", 2);
    await expect(authorizeOrder({ quoteId: q.id, signature: sign(q.message), idempotencyKey: "k-funds-000000001", shipping: ship, consent: true, ipHash: "ip1" })).rejects.toMatchObject({ code: "insufficient_funds", status: 402 });
  });

  it("cancels and refunds; revenue keeps sandbox separate and excludes refunds", async () => {
    const { authorizeOrder, cancelOrder, commerceRevenue, ordersFor } = await import("@/lib/commerce/orders");
    const q = await quote("bajar-sandbox:tst-sn1");
    const o = await authorizeOrder({ quoteId: q.id, signature: sign(q.message), idempotencyKey: "k-refund-00000001", shipping: ship, consent: true, ipHash: "ip1" });
    const c = await cancelOrder(o.token!, "changed mind");
    expect(c.status).toBe("refunded");
    expect(c.refundedUsd).toBeCloseTo(q.totalUsd, 2);
    const mine = await ordersFor({ tokens: [o.token!] });
    expect(mine.map((x) => x.id)).toContain(o.id);
    expect(mine[0].shipTo).toBe("Test · Austin, US");
    const rev = await commerceRevenue();
    expect(rev.live.orders).toBe(0);
    expect(rev.sandbox.refunds).toBeCloseTo(q.totalUsd, 2);
    expect(rev.sandbox.failed).toBe(1);
    expect(rev.sandbox.net).toBeCloseTo(rev.sandbox.bajarFees + rev.sandbox.commissions, 2);
  });
});

describe("shopping profile + store logins", () => {
  beforeAll(async () => { (await import("@/lib/treasury/db")).__useMemoryDb(); });
  const addr = { id: "home", label: "Home", name: "Ada Lovelace", line1: "1 Test St", city: "Austin", region: "TX", postal: "78701", country: "us" };

  it("validates and normalizes profile input", async () => {
    const { cleanProfile, ProfileError } = await import("@/lib/commerce/profile");
    const p = cleanProfile({ name: " Ada ", email: "ada@example.org", phone: "+1 512 555 0100", addresses: [addr] });
    expect(p).toMatchObject({ name: "Ada", defaultAddress: "home", addresses: [{ country: "US" }] });
    expect(() => cleanProfile({ email: "nope" })).toThrow(ProfileError);
    expect(() => cleanProfile({ addresses: [{ ...addr, postal: "" }] })).toThrow(/postal/);
  });

  it("stores the profile encrypted and returns it only by profile id", async () => {
    const { cleanProfile, getShoppingProfile, saveShoppingProfile, deleteShoppingProfile } = await import("@/lib/commerce/profile");
    const { q } = await import("@/lib/treasury/db");
    await saveShoppingProfile("prf_a", cleanProfile({ name: "Ada", email: "ada@example.org", addresses: [addr] }));
    const raw = (await q<{ data_enc: string }>("select data_enc from shopping_profiles where profile_id='prf_a'"))[0].data_enc;
    expect(raw).not.toContain("Ada");
    expect(raw).not.toContain("Austin");
    expect((await getShoppingProfile("prf_a")).addresses[0].city).toBe("Austin");
    expect((await getShoppingProfile("prf_b")).name).toBe("");
    await deleteShoppingProfile("prf_a");
    expect((await getShoppingProfile("prf_a")).addresses).toHaveLength(0);
  });

  it("builds Shopify prefilled checkout links", async () => {
    const { cleanProfile, shopifyPrefillUrl, defaultAddress } = await import("@/lib/commerce/profile");
    const p = cleanProfile({ name: "Ada", email: "ada@example.org", phone: "+15125550100", addresses: [addr] });
    const u = new URL(shopifyPrefillUrl("ridge.com", 4242, 2, p, defaultAddress(p)));
    expect(u.origin + u.pathname).toBe("https://ridge.com/cart/4242:2");
    expect(u.searchParams.get("checkout[email]")).toBe("ada@example.org");
    expect(u.searchParams.get("checkout[shipping_address][first_name]")).toBe("Ada");
    expect(u.searchParams.get("checkout[shipping_address][last_name]")).toBe("Lovelace");
    expect(u.searchParams.get("checkout[shipping_address][zip]")).toBe("78701");
    expect(u.searchParams.get("checkout[shipping_address][phone]")).toBe("+15125550100");
  });

  it("store sign-in is OAuth-only, off until configured, and never overwrites the user's own details", async () => {
    const { storeConnectors, mergeImport, cleanProfile, saveStoreAccount, storeAccounts, disconnectStore } = await import("@/lib/commerce/profile");
    for (const c of storeConnectors()) { expect(c.configured).toBe(false); expect(c.missing.length).toBeGreaterThan(0); }
    process.env.AMAZON_LWA_CLIENT_ID = "amzn1.application-oa2-client.test";
    process.env.AMAZON_LWA_CLIENT_SECRET = "x";
    const amazon = storeConnectors().find((c) => c.id === "amazon")!;
    expect(amazon.configured).toBe(true);
    const url = new URL(amazon.authorizeUrl("st8", "https://www.sharebajar.com/api/stores/callback/amazon"));
    expect(url.host).toBe("www.amazon.com");
    expect(url.searchParams.get("state")).toBe("st8");
    expect(url.searchParams.get("scope")).toBe("profile postal_code");
    delete process.env.AMAZON_LWA_CLIENT_ID; delete process.env.AMAZON_LWA_CLIENT_SECRET;
    const merged = mergeImport(cleanProfile({ name: "Mine", email: "" }), { name: "Amazon Name", email: "a@example.org" });
    expect(merged).toMatchObject({ name: "Mine", email: "a@example.org" });
    await saveStoreAccount("prf_c", "ebay", { accountName: "ada_buys", token: { refresh: "r", access: "a" }, scopes: "commerce.identity.readonly" });
    expect(await storeAccounts("prf_c")).toMatchObject([{ store: "ebay", accountName: "ada_buys" }]);
    await disconnectStore("prf_c", "ebay");
    expect(await storeAccounts("prf_c")).toHaveLength(0);
  });
});

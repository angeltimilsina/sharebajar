import { expect, test, type Page } from "@playwright/test";
import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * BAJAR Agents + BAJAR Pay (sandbox). Wallet authorizations are real ed25519
 * signatures made in Node; the sandbox merchant moves no money.
 */
async function stubPhantom(page: Page, opts: { reject?: boolean } = {}) {
  const k = nacl.sign.keyPair();
  const pk = bs58.encode(k.publicKey);
  await page.exposeFunction("__nodeSign", (msg: number[]) => Array.from(nacl.sign.detached(new Uint8Array(msg), k.secretKey)));
  await page.addInitScript(({ pk, reject }) => {
    const w = window as unknown as { __nodeSign: (m: number[]) => Promise<number[]>; phantom: unknown };
    const provider = {
      isPhantom: true,
      publicKey: null as null | { toString(): string },
      connect: async () => { provider.publicKey = { toString: () => pk }; return { publicKey: provider.publicKey }; },
      disconnect: async () => { provider.publicKey = null; },
      signMessage: async (m: Uint8Array) => { if (reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 }); return { signature: new Uint8Array(await w.__nodeSign(Array.from(m))) }; },
      on: () => {}, off: () => {},
    };
    w.phantom = { solana: provider };
  }, { pk, reject: !!opts.reject });
  return pk;
}

async function openCheckout(page: Page, product: string, title: RegExp) {
  await page.goto(`/agents?product=${product}`);
  const card = page.getByTestId("offer-card").filter({ hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 40_000 });
  await card.click();
  await expect(page.getByTestId("capability")).toContainText("BAJAR Pay · sandbox merchant");
  await page.getByTestId("pay-with-bajar").click();
  const sheet = page.getByTestId("checkout-sheet");
  await expect(sheet.getByTestId("sandbox-banner")).toBeVisible();
  await sheet.getByRole("button", { name: "Connect wallet to continue" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
  await expect(sheet.getByTestId("ship-form")).toBeVisible({ timeout: 15_000 });
  await sheet.getByLabel("Full name").fill("Test Buyer");
  await sheet.getByLabel("Street address").fill("1 Test St");
  await sheet.getByLabel("City").fill("Austin");
  await sheet.getByLabel("Postal code").fill("78701");
  return sheet;
}

async function review(page: Page) {
  const sheet = page.getByTestId("checkout-sheet");
  await sheet.getByTestId("get-quote").click();
  await expect(sheet.getByTestId("quote")).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByTestId("quote")).toContainText("BAJAR Pay fee");
  await expect(sheet.getByTestId("authorize")).toBeDisabled(); // consent first
  await sheet.getByTestId("consent").check();
  return sheet;
}

test.describe("BAJAR Agents", () => {
  test.setTimeout(120_000);

  test("home: hero, hashtag agents, link checks", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.getByRole("heading", { name: /Anything you want\.\s*One place to find it\./ })).toBeVisible();
    for (const t of ["find", "deals", "compare", "verify", "shipping", "budget", "crypto", "checkout", "track"]) await expect(page.getByTestId(`tag-${t}`)).toBeVisible();
    await expect(page.getByTestId("pay-selector")).toContainText("USDC");
    await page.getByTestId("agents-input").fill("https://arnazon.com/dp/B0CHX1W1XY");
    await expect(page.getByTestId("link-chip")).toContainText("imitates amazon");
    await page.getByTestId("agents-input").fill("https://www.amazon.com/dp/B0CHX1W1XY");
    await expect(page.getByTestId("link-chip")).toContainText("B0CHX1W1XY");
  });

  test("chat → parallel agents → sandbox purchase → tracking → cancel & refund", async ({ page }) => {
    await stubPhantom(page);
    await page.goto("/agents");
    await page.getByTestId("tag-find").click();
    await page.getByTestId("tag-compare").click();
    await page.getByTestId("tag-verify").click();
    await page.getByTestId("tag-crypto").click();
    await page.getByTestId("agents-input").fill("TEST headphones under $300");
    await page.getByTestId("agents-send").click();
    for (const a of ["find", "compare", "verify", "crypto"]) await expect(page.getByTestId(`agent-${a}`)).toHaveAttribute("data-status", "done", { timeout: 40_000 });
    await expect(page.getByTestId("agent-verify")).toContainText("Bajar Test Store");
    await expect(page.getByTestId("agents-summary")).toBeVisible();
    await page.getByTestId("offer-card").filter({ hasText: "Headphones" }).first().click();
    await page.getByTestId("pay-with-bajar").click();
    const sheet = page.getByTestId("checkout-sheet");
    await sheet.getByRole("button", { name: "Connect wallet to continue" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
    await sheet.getByLabel("Full name").fill("Test Buyer");
    await sheet.getByLabel("Street address").fill("1 Test St");
    await sheet.getByLabel("City").fill("Austin");
    await sheet.getByLabel("Postal code").fill("78701");
    await review(page);
    await expect(sheet.getByTestId("quote-total")).toHaveText("$200.00"); // $199 + 0.5% fee
    await sheet.getByTestId("authorize").click();
    await expect(sheet.getByTestId("receipt")).toHaveAttribute("data-status", "confirmed", { timeout: 15_000 });
    await expect(sheet.getByTestId("receipt")).toContainText("no funds moved");

    await sheet.getByRole("link", { name: "Track order" }).click();
    const order = page.getByTestId("order").first();
    await expect(order).toHaveAttribute("data-status", "confirmed");
    await expect(order).toContainText("SANDBOX");
    await order.getByTestId("cancel-order").click();
    await expect(page.getByTestId("order").first()).toHaveAttribute("data-status", "refunded");
    await expect(page.getByTestId("order").first()).toContainText("Refunded $200.00");
  });

  test("wallet rejection charges nothing", async ({ page }) => {
    await stubPhantom(page, { reject: true });
    await openCheckout(page, "tst-sn1", /Sneakers/);
    const sheet = await review(page);
    await sheet.getByTestId("authorize").click();
    await expect(sheet.getByTestId("checkout-error")).toHaveAttribute("data-code", "rejected");
    await expect(sheet.getByTestId("checkout-error")).toContainText("Nothing was charged");
  });

  test("merchant confirmation failure", async ({ page }) => {
    await stubPhantom(page);
    await openCheckout(page, "tst-fail", /Merchant-offline/);
    const sheet = await review(page);
    await sheet.getByTestId("authorize").click();
    await expect(sheet.getByTestId("receipt")).toHaveAttribute("data-status", "merchant_failed", { timeout: 15_000 });
    await expect(sheet.getByTestId("receipt")).toContainText("nothing was charged");
  });

  test("insufficient sandbox funds", async ({ page }) => {
    await stubPhantom(page);
    const s0 = await openCheckout(page, "tst-lp1", /Laptop/);
    await s0.getByTestId("qty").selectOption("2"); // 2 × $899 is over the $1,000/day of sandbox test funds
    const sheet = await review(page);
    await sheet.getByTestId("authorize").click();
    await expect(sheet.getByTestId("checkout-error")).toHaveAttribute("data-code", "insufficient_funds");
  });

  test("expired quote must be refreshed", async ({ page }) => {
    await stubPhantom(page);
    await page.route("**/api/commerce/quote", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.quote.expiresAt = Date.now() - 1000;
      await route.fulfill({ response: res, json: body });
    });
    await openCheckout(page, "tst-wt1", /Smart Watch/);
    const sheet = page.getByTestId("checkout-sheet");
    await sheet.getByTestId("get-quote").click();
    await expect(sheet.getByTestId("quote-timer")).toContainText("Quote expired");
    await expect(sheet.getByTestId("authorize")).toHaveCount(0);
    await expect(sheet.getByTestId("refresh-quote")).toBeVisible();
  });

  test("unsupported merchant: external checkout, no BAJAR quote", async ({ page, request }) => {
    const r = await request.post("/api/commerce/quote", { data: { offerId: "shopify:ridge.com:123", quantity: 1, asset: "USDC", wallet: bs58.encode(nacl.sign.keyPair().publicKey), chainType: "solana" }, headers: { origin: "http://localhost:3100" } });
    expect(r.status()).toBe(409);
    expect((await r.json()).code).toBe("external_checkout");
    // UI: a real-merchant offer (shape as the stream sends it) offers only the merchant's checkout.
    const offer = { id: "shopify:ridge.com:1", retailer: "shopify", merchant: "Ridge", merchantDomain: "ridge.com", seller: null, productId: "1", title: "The Ridge Wallet", brand: "Ridge", image: null, images: [], url: "https://ridge.com/products/wallet", currency: "USD", price: 95, compareAtPrice: null, shipping: null, tax: null, inStock: true, specs: {}, source: "Shopify storefront data", fetchedAt: Date.now() };
    await page.route("**/api/agents/run", (route) => route.fulfill({ contentType: "application/x-ndjson", body: [{ type: "products", items: [offer] }, { type: "checkout", offer, mode: "external" }, { type: "summary", text: "x", ai: false }, { type: "end" }].map((e) => JSON.stringify(e)).join("\n") + "\n" }));
    await page.goto("/agents");
    await page.getByTestId("agents-input").fill("ridge wallet");
    await page.getByTestId("agents-send").click();
    await page.getByTestId("offer-card").first().click();
    await expect(page.getByTestId("capability")).toContainText("Checkout on the merchant's site");
    await expect(page.getByTestId("pay-with-bajar")).toHaveCount(0);
    await expect(page.getByTestId("external-checkout")).toHaveAttribute("href", "https://ridge.com/products/wallet");
  });
});

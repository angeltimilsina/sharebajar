import { expect, test, type Page } from "@playwright/test";
import nacl from "tweetnacl";
import bs58 from "bs58";

/** Once signed in, you stay signed in across pages and full reloads. */
const K = nacl.sign.keyPair();
const ADDR = bs58.encode(K.publicKey);
const short = `${ADDR.slice(0, 4)}…${ADDR.slice(-4)}`;

async function stubPhantom(page: Page, trusted = true) {
  await page.exposeFunction("__nodeSign", (msg: number[]) => Array.from(nacl.sign.detached(new Uint8Array(msg), K.secretKey)));
  await page.addInitScript(({ pk, trusted }) => {
    const w = window as unknown as { __nodeSign: (m: number[]) => Promise<number[]>; phantom: unknown };
    const provider = {
      isPhantom: true,
      publicKey: null as null | { toString(): string },
      // A trusted site reconnects silently on page load, like the real extension.
      connect: async (o?: { onlyIfTrusted?: boolean }) => { if (o?.onlyIfTrusted && !trusted) throw new Error("User rejected the request."); provider.publicKey = { toString: () => pk }; return { publicKey: provider.publicKey }; },
      disconnect: async () => { provider.publicKey = null; },
      signMessage: async (m: Uint8Array) => ({ signature: new Uint8Array(await w.__nodeSign(Array.from(m))) }),
      on: () => {}, off: () => {},
    };
    w.phantom = { solana: provider };
  }, { pk: ADDR, trusted });
}

async function connectAndSignIn(page: Page) {
  await page.goto("/agents/profile");
  await page.getByTestId("profile-signin-btn").click();
  await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click(); // connect = sign in
  await expect(page.getByTestId("shopping-profile")).toBeVisible({ timeout: 15_000 });
}

test.describe("staying logged in", () => {
  test.setTimeout(90_000);

  test("wallet and sign-in persist across pages and full reloads", async ({ page }) => {
    await stubPhantom(page);
    await connectAndSignIn(page);
    for (const path of ["/tokens", "/launchpad", "/agents", "/agents/orders", "/pro", "/"]) {
      await page.goto(path); // full page load each time
      await expect(page.getByTestId("account-button")).toContainText(short, { timeout: 10_000 });
      await expect(page.getByTestId("wallet-sidebar")).toBeHidden();
    }
    await page.goto("/agents/profile");
    await expect(page.getByTestId("shopping-profile")).toBeVisible({ timeout: 15_000 }); // no new signature needed
  });

  test("if the wallet can't reconnect silently, you stay signed in with a one-tap reconnect", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [{ name: "bajar_consent", value: "v1", domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }], origins: [] } });
    const page = await ctx.newPage();
    await stubPhantom(page, false);
    await connectAndSignIn(page);
    await page.goto("/tokens");
    await expect(page.getByTestId("account-button")).toContainText(short, { timeout: 10_000 });
    await page.getByTestId("account-button").click();
    await expect(page.getByTestId("account-session")).toContainText("Signed in");
    await expect(page.getByTestId("account-reconnect")).toBeVisible();
    await page.goto("/agents/profile");
    await expect(page.getByTestId("store-accounts")).toBeVisible();
    await ctx.close();
  });

  test("agentic billing: default asset and spending limit apply to checkout; receipt keeps the details", async ({ page }) => {
    await stubPhantom(page);
    await connectAndSignIn(page);
    const form = page.getByTestId("shopping-profile");
    await form.getByLabel("Full name").first().fill("Ada Lovelace");
    await page.getByTestId("add-address").click();
    const a = page.getByTestId("address").first();
    await a.getByLabel("Street address").fill("1 Test St");
    await a.getByLabel("City").fill("Austin");
    await a.getByLabel("Postal code").fill("78701");
    await page.getByTestId("billing-same").uncheck();
    const b = page.getByTestId("billing-address");
    await b.getByLabel("Billing name").fill("Ada Lovelace");
    await b.getByLabel("Billing street").fill("9 Bill Rd");
    await b.getByLabel("Billing city").fill("Dallas");
    await b.getByLabel("Billing postal code").fill("75201");
    await page.getByTestId("pay-default-asset").selectOption("USDT");
    await page.getByTestId("agent-limit").fill("150");
    await page.getByTestId("save-profile").click();
    await expect(page.getByTestId("profile-msg")).toContainText("Saved");

    // Over the limit: agents won't prepare it.
    await page.goto("/agents?product=tst-hp1");
    await page.getByTestId("offer-card").filter({ hasText: /Headphones/ }).first().click({ timeout: 40_000 });
    await page.getByTestId("pay-with-bajar").click();
    let sheet = page.getByTestId("checkout-sheet");
    await expect(sheet.getByTestId("pay-asset")).toHaveValue("USDT", { timeout: 15_000 });
    await expect(sheet.getByTestId("bill-to")).toContainText("Dallas");
    await sheet.getByTestId("get-quote").click();
    await expect(sheet.getByTestId("checkout-error")).toHaveAttribute("data-code", "agent_limit");

    // Under the limit: purchase, then the receipt keeps the full details.
    await page.goto("/agents?product=tst-sn1");
    await page.getByTestId("offer-card").filter({ hasText: /Sneakers/ }).first().click({ timeout: 40_000 });
    await page.getByTestId("pay-with-bajar").click();
    sheet = page.getByTestId("checkout-sheet");
    await expect(sheet.getByLabel("Street address")).toHaveValue("1 Test St", { timeout: 15_000 });
    await sheet.getByTestId("get-quote").click();
    await expect(sheet.getByTestId("quote")).toContainText("USDT");
    await sheet.getByTestId("consent").check();
    await sheet.getByTestId("authorize").focus();
    await page.keyboard.press("Enter");
    await expect(sheet.getByTestId("receipt")).toHaveAttribute("data-status", "confirmed", { timeout: 15_000 });
    await page.goto("/agents/orders");
    const r = page.getByTestId("receipt-details").first();
    await r.locator("summary").click();
    await expect(r.getByTestId("receipt-ship-to")).toContainText("1 Test St");
    await expect(r.getByTestId("receipt-bill-to")).toContainText("9 Bill Rd");
    await expect(r).toContainText("prepared by BAJAR Agents");
    await expect(r).toContainText("USDT");
  });

  test("one gateway: connecting signs in; declining the signature means not connected", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [{ name: "bajar_consent", value: "v1", domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }], origins: [] } });
    const page = await ctx.newPage();
    await page.addInitScript((pk) => {
      const provider = {
        isPhantom: true, publicKey: null as null | { toString(): string },
        connect: async () => { provider.publicKey = { toString: () => pk }; return { publicKey: provider.publicKey }; },
        disconnect: async () => { provider.publicKey = null; },
        signMessage: async () => { throw Object.assign(new Error("User rejected the request."), { code: 4001 }); },
        on: () => {}, off: () => {},
      };
      (window as unknown as { phantom: unknown }).phantom = { solana: provider };
    }, ADDR);
    await page.goto("/tokens");
    await page.getByTestId("account-button").click();
    await page.getByTestId("account-connect").click();
    await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Your wallet wasn't connected", { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("account-button")).not.toContainText(short);
    expect((await (await page.request.get("/api/auth/session")).json()).session).toBeNull();
    await ctx.close();
  });

  test("sessions are server-side: signing out revokes the cookie, even a copied one", async ({ page }) => {
    await stubPhantom(page);
    await connectAndSignIn(page);
    const cookie = (await page.context().cookies()).find((c) => c.name === "sb_session")!;
    expect(cookie.httpOnly).toBe(true);
    const ok = await page.request.get("/api/commerce/profile");
    expect(ok.status()).toBe(200);
    await page.getByTestId("account-button").click();
    await expect(page.getByTestId("auth-status")).toContainText("Verified by wallet signature");
    await page.getByTestId("account-disconnect").click();
    await expect(page.getByTestId("account-button")).not.toContainText(short, { timeout: 10_000 });
    // Replay the old cookie: the gateway refuses it.
    const replay = await page.request.get("/api/commerce/profile", { headers: { cookie: `sb_session=${cookie.value}` } });
    expect(replay.status()).toBe(401);
  });

  test("no footer on any page", async ({ page }) => {
    for (const path of ["/", "/tokens", "/launchpad", "/agents", "/learn", "/status"]) {
      await page.goto(path);
      await expect(page.locator("footer")).toHaveCount(0);
    }
  });
});

import { expect, test } from "@playwright/test";

const ldTypes = async (page: import("@playwright/test").Page) =>
  (await page.locator('script[type="application/ld+json"]').allTextContents()).flatMap((t) => {
    const j = JSON.parse(t);
    return (Array.isArray(j) ? j : [j]).map((x: { "@type": string }) => x["@type"]);
  });

test.describe("seo", () => {
  test.setTimeout(90_000);

  test("coin page: price title, canonical, JSON-LD, written summary, related links", async ({ page }) => {
    await page.goto("/coin/bitcoin");
    await expect(page).toHaveTitle(/Bitcoin price today/);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toMatch(/\/coin\/bitcoin$/);
    const types = await ldTypes(page);
    for (const t of ["WebPage", "BreadcrumbList", "FAQPage"]) expect(types).toContain(t);
    await expect(page.getByTestId("seo-summary").first()).toContainText("Bitcoin price is");
    await expect(page.getByTestId("coin-related").getByRole("link").first()).toBeVisible();
  });

  test("market list pages render a ranked, crawlable table", async ({ page }) => {
    await page.goto("/markets/top-gainers");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Top crypto gainers today");
    await expect(page.getByTestId("seo-table").locator('a[href^="/coin/"]').first()).toBeVisible();
    expect(await ldTypes(page)).toContain("ItemList");
    await page.goto("/markets/memecoins");
    await expect(page.getByTestId("seo-table").locator('a[href="/coin/dogecoin"]')).toBeVisible();
  });

  test("markets index links to topics and comparisons", async ({ page }) => {
    await page.goto("/markets");
    await expect(page.getByRole("link", { name: "Top gainers" }).first()).toBeVisible();
    await expect(page.getByTestId("compare-links").getByRole("link").first()).toBeVisible();
  });

  test("compare page: table, FAQ, and reversed order redirects to canonical", async ({ page }) => {
    await page.goto("/compare/bitcoin-vs-ethereum");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Bitcoin");
    await expect(page.getByTestId("compare-table")).toContainText("Market cap");
    expect(await ldTypes(page)).toContain("FAQPage");
    await page.goto("/compare/ethereum-vs-bitcoin");
    await expect(page).toHaveURL(/\/compare\/bitcoin-vs-ethereum$/);
  });

  test("sitemap lists coins, market lists and comparisons; robots points to it", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const p of ["/coin/bitcoin", "/markets/top-gainers", "/compare/bitcoin-vs-ethereum"]) expect(xml).toContain(p);
    expect(xml).not.toContain("/charts");
    expect(await (await request.get("/robots.txt")).text()).toContain("sitemap.xml");
  });

  test("launchpad: form is usable and the wallet is only requested to launch", async ({ page }) => {
    await page.goto("/launchpad");
    await expect(page.getByLabel("Token name", { exact: true })).toBeVisible({ timeout: 30_000 });
    // No wallet is requested to fill the details or pick networks.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("wizard-next")).toBeDisabled();
  });
});

test.describe("app pages", () => {
  test("portfolio shows feature cards when signed out; app pages have no footer", async ({ page }) => {
    await page.goto("/portfolio");
    const intro = page.getByTestId("portfolio-intro");
    for (const t of ["How Bajar manages your portfolio", "Works with the wallets you use", "Post-quantum signatures", "Everything in Bajar"]) await expect(intro.getByText(t)).toBeVisible();
    await expect(page.locator(".site-footer")).toBeHidden();
    await page.goto("/trade");
    await expect(page.getByTestId("trade-launch")).toBeVisible();
    await expect(page.getByTestId("trade-connect")).toBeVisible();
    await expect(page.locator(".site-footer")).toBeHidden();
    await page.goto("/discover");
    await expect(page.locator(".site-footer")).toBeHidden();
    await page.goto("/markets");
    await expect(page.locator(".site-footer")).toBeVisible();
  });
});

test.describe("search @mobile", () => {
  test("opens full-screen with a 16px field, finds results, cancels @mobile", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search tokens" }).first().click();
    const box = page.getByRole("textbox", { name: "Search" });
    await expect(box).toBeFocused();
    expect(await box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await box.fill("solana");
    await expect(page.getByTestId("search-dialog").getByText("Listed coins")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("search-cancel").click();
    await expect(page.getByTestId("search-dialog")).toHaveCount(0);
  });
});

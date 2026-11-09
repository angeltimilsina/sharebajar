import { expect, test } from "@playwright/test";

// Discover → Asset detail → Trade / Swap → Portfolio, as one continuous experience.
test.describe("journey", () => {
  test.setTimeout(120_000);

  test("navigation: Tokens and Launchpad, the rest under More, wallet in the sidebar", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveText(["Tokens", "Launchpad"]);
    await page.getByTestId("more-menu").click();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText([/Markets/, /Trade/, /Discover/, /Bajar Intelligence/, /Bajar Pro/, /System status/]);
    const side = page.getByTestId("wallet-sidebar");
    await expect(side.getByTestId("menu-connect")).toBeVisible();
    await expect(side.getByRole("link", { name: "Portfolio" })).toBeVisible();
    await expect(side.getByTestId("open-agent")).toBeVisible();
    // Collapses to an icon rail and remembers it.
    await page.getByTestId("sidebar-collapse").click();
    await expect(page.locator("html")).toHaveAttribute("data-sb", "collapsed");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-sb", "collapsed");
    await expect(side.getByTestId("menu-connect")).toBeVisible();
  });

  test("tokens marketplace: trending Solana, Base and EVM launches, then tabs", async ({ page }) => {
    await page.goto("/tokens");
    await expect(page.getByRole("heading", { name: "Tokens", level: 1 })).toBeVisible();
    const cols = page.getByTestId("trending-column");
    await expect(cols).toHaveCount(3);
    await expect(cols.nth(0)).toContainText("Trending on Solana");
    await expect(cols.nth(1)).toContainText("Trending on Base");
    await expect(cols.nth(2)).toContainText("Trending on EVM");
    await expect(cols.nth(0).locator('a[href^="/token/solana/"]').first()).toBeVisible({ timeout: 45_000 });
    await page.getByRole("tab", { name: /Liquidity pools/ }).click();
    await expect(page).toHaveURL(/tab=pools/);
    await page.getByTestId("net-base").click();
    await expect(page).toHaveURL(/network=base/);
    await expect(page.locator('table a[href^="/token/base/"]').first()).toBeVisible({ timeout: 45_000 });
  });

  test("discover → detail keeps network and pair → trade and swap stay on the asset page", async ({ page }) => {
    await page.goto("/discover");
    const first = page.locator('a[href^="/token/"][href*="?pair="]').first();
    await expect(first).toBeVisible({ timeout: 45_000 });
    const href = (await first.getAttribute("href"))!;
    const [, , chain, address] = href.split("?")[0].split("/");
    const pair = new URL(href, "http://x").searchParams.get("pair");
    await first.click();
    await expect(page).toHaveURL(new RegExp(`/token/${chain}/${address}\\?pair=${pair}`));

    // Overview → Trade: same page, mode in the URL, execution panel visible.
    await page.getByTestId("mode-trade").click();
    await expect(page).toHaveURL(/mode=trade/);
    await expect(page).toHaveURL(new RegExp(`/token/${chain}/${address}`));
    await expect(page.getByTestId("asset-execution")).toBeVisible();
    await expect(page.getByTestId("side-buy")).toBeVisible();
    await expect(page.getByText("Order type")).toBeVisible();

    // Trade → Swap: still the same asset page.
    await page.getByTestId("mode-swap").click();
    await expect(page).toHaveURL(/mode=swap/);
    await expect(page).toHaveURL(new RegExp(`/token/${chain}/${address}`));
    await expect(page.getByTestId("asset-execution")).toBeVisible();

    // Mode switches don't pile up history: Back returns to the stage you came from.
    await page.goBack();
    await expect(page).toHaveURL(/\/discover/);
  });

  test("Solana swap: destination prefilled, full quote shown, wallet requested only to execute", async ({ page }) => {
    // BONK on Solana — deep liquidity, routable by Jupiter.
    await page.goto("/token/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263?mode=swap");
    const exec = page.getByTestId("asset-execution");
    await expect(exec).toBeVisible({ timeout: 45_000 });
    await expect(exec.getByRole("button", { name: /bonk/i })).toBeVisible({ timeout: 30_000 });
    await exec.getByLabel("Amount to pay").fill("0.05");
    for (const label of ["Rate", "Price impact", "Platform fee", "Minimum received", "Route", "Network fee"]) {
      await expect(exec.getByText(label, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    }
    await expect(exec.getByRole("button", { name: /Connect wallet to swap/ })).toBeVisible();
  });

  test("coin page: Buy opens the trade mode in place with chart and order book", async ({ page }) => {
    await page.goto("/coin/solana?mode=trade&side=buy");
    await expect(page.getByTestId("asset-execution")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("side-buy")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Order Book").locator("visible=true").first()).toBeVisible();
  });

  test("portfolio shows activity with status", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("bajar.activity.v1", JSON.stringify([
      { id: "solana:x", chain: "solana", hash: "5".repeat(88), kind: "swap", summary: "Swapped 0.05 SOL → BONK", status: "confirmed", at: Date.now() - 60_000, assetHref: "/token/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
    ])));
    await page.goto("/portfolio");
    const panel = page.getByTestId("portfolio-activity");
    await expect(panel.getByText("Swapped 0.05 SOL → BONK")).toBeVisible();
    await expect(panel.getByText("Confirmed")).toBeVisible();
    await panel.getByRole("link", { name: "Open asset" }).click();
    await expect(page).toHaveURL(/\/token\/solana\/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263/);
  });

  test("/charts redirects into the Trade workspace keeping the market", async ({ page }) => {
    await page.goto("/charts?symbol=ETHUSDT");
    await expect(page).toHaveURL(/\/trade\?symbol=ETHUSDT/);
  });
});

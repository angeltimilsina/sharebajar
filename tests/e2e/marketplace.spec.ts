import { expect, test } from "@playwright/test";
import { fakeAuth } from "./fakeAuth";

test.describe("public marketplace", () => {
  test("homepage renders market overview without an account", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Markets" })).toBeVisible();
    // No hero or stat cards: straight into the market list.
    await expect(page.getByText("Total Market Cap")).toHaveCount(0);
    await expect(page.locator("main .pulse-dot")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Top", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("board-row").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Trending Tokens", { exact: true })).toBeVisible();
  });

  test("network filter switches market feeds", async ({ page }) => {
    await page.goto("/");
    const sol = page.getByRole("radio", { name: /Solana/ });
    await sol.click();
    await expect(sol).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("board-caption")).toContainText("Solana");
    await page.getByRole("tab", { name: "New", exact: true }).click();
    await expect(page.getByRole("tab", { name: "New", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("stat switch changes the highlighted stat and what gainers means", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("board-row").first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("board-stats").getByRole("radio", { name: "7d" }).click();
    await expect(page.getByTestId("board-stats").getByRole("radio", { name: "7d" })).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("lens-gainers").click();
    await expect(page.getByTestId("board-caption")).toContainText("Gainers · 7d");
    // Ribbon chips carry live previews; suggestions open a filtered list.
    await expect(page.getByTestId("lens-gainers")).toContainText(/[+-]\d/);
    const suggestion = page.locator('[data-testid^="lens-"]').filter({ has: page.locator("svg.lucide-sparkles") }).first();
    if (await suggestion.count()) {
      await suggestion.click();
      await expect(page.getByTestId("board-caption")).toContainText(/coins?/);
      await page.getByTestId("lens-gainers").click();
    }
    // Preference is remembered.
    await page.reload();
    await expect(page.getByTestId("board-caption")).toContainText("Gainers · 7d");
  });

  test("live ticker connects to the price stream", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Live", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  });

  test("global search finds tokens", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("textbox", { name: "Search" });
    await expect(async () => {
      await page.getByRole("button", { name: "Search tokens" }).first().click();
      await expect(box).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await box.fill("bonk");
    await expect(page.getByText("On-chain tokens")).toBeVisible({ timeout: 20_000 });
  });

  test("theme toggle switches and persists light mode", async ({ page }) => {
    // Default follows the device; start from a dark device and switch to light.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await page.getByRole("button", { name: /Switch to light mode/ }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("shows an honest error instead of stale prices when market data fails", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sb.watchlist.v1", JSON.stringify([{ kind: "coin", id: "bitcoin", label: "BTC", addedAt: 1 }])));
    await page.route("**/api/market/coins?ids=**", (r) => r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "api.coinlore.net unavailable (503)" }) }));
    await page.goto("/");
    await expect(async () => {
      await page.getByRole("tab", { name: "Watchlist", exact: true }).click();
      await expect(page.getByRole("tab", { name: "Watchlist", exact: true })).toHaveAttribute("aria-selected", "true", { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByText("Market data unavailable")).toBeVisible();
  });
});

test.describe("charts", () => {
  test("coin page streams 1-second candles", async ({ page }) => {
    await page.goto("/charts?symbol=BTCUSDT");
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.getByRole("button", { name: "1s", exact: true }).click();
    await expect(page.getByText("Live stream")).toBeVisible({ timeout: 30_000 });
  });

  test("indicators panel toggles RSI", async ({ page }) => {
    await page.goto("/charts?symbol=ETHUSDT");
    await page.getByRole("button", { name: /Indicators/ }).click();
    const rsi = page.getByLabel("RSI 14");
    await rsi.check();
    await expect(rsi).toBeChecked();
  });
});

test.describe("wallet", () => {
  test("wallet picker never asks for a seed phrase and offers Bajar Wallet", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("button", { name: /Connect/ })).toHaveCount(0); // not in the top bar
    await page.getByTestId("menu-button").click();
    await page.getByTestId("menu-connect").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Bajar Wallet · Solana")).toBeVisible();
    await expect(dialog.getByText("Bajar Wallet · EVM")).toBeVisible();
    await expect(dialog.getByText("Phantom")).toBeVisible();
    await expect(dialog.getByText("MetaMask")).toBeVisible();
    await expect(dialog.getByText(/seed phrase or private key/)).toBeVisible();
  });

  test("connects and disconnects an injected Solana wallet", async ({ page }) => {
    await fakeAuth(page);
    await page.addInitScript(() => {
      const pk = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
      const provider = {
        isPhantom: true,
        publicKey: null as null | { toString(): string },
        connect: async () => { provider.publicKey = { toString: () => pk }; return { publicKey: provider.publicKey }; },
        disconnect: async () => { provider.publicKey = null; },
        signMessage: async () => ({ signature: new Uint8Array(64) }),
        on: () => {}, off: () => {},
      };
      (window as unknown as { phantom: unknown }).phantom = { solana: provider };
    });
    await page.goto("/");
    await page.getByTestId("menu-connect").click();
    await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
    // Connected: no Connect button, no footer; wallet controls live in the menu.
    await expect(page.getByTestId("menu-connect")).toHaveCount(0);
    await expect(page.locator(".site-footer")).toBeHidden();
    await expect(page.getByTestId("wallet-sidebar")).toHaveCount(0); // side menu goes away once connected
    await page.getByTestId("account-button").click();
    const menu = page.getByTestId("account-menu");
    await expect(menu.getByText("9WzD…AWWM")).toBeVisible();
    await expect(page.getByTestId("account-switch")).toBeVisible();
    await page.getByTestId("account-disconnect").click();
    await expect(page.locator("footer, .site-footer")).toHaveCount(0); // no footers anywhere
    await expect(page.getByTestId("menu-connect")).toBeVisible();
  });
});

test.describe("trading", () => {
  test("swap panel fetches a live Jupiter quote", async ({ page }) => {
    await page.goto("/trade");
    await page.getByLabel("Amount to pay").fill("0.1");
    await expect(page.getByText("Minimum received", { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Route/)).toBeVisible();
  });
});

test("homepage has no horizontal overflow on desktop", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Markets" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test.describe("mobile @mobile", () => {
  test("homepage has no horizontal overflow on phones @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Markets" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("tapping the stat on a row cycles the stat @mobile", async ({ page }) => {
    await page.goto("/");
    const pill = page.getByTestId("board-stat-pill").first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.getByTestId("board-stats").getByRole("radio", { name: "7d" })).toHaveAttribute("aria-checked", "true");
  });
});

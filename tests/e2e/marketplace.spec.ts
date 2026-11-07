import { expect, test } from "@playwright/test";

test.describe("public marketplace", () => {
  test("homepage renders market overview without an account", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Open Crypto Marketplace/ })).toBeVisible();
    await expect(page.getByText("Total Market Cap")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Market Overview" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Trending Tokens")).toBeVisible();
  });

  test("network filter switches market feeds", async ({ page }) => {
    await page.goto("/");
    const sol = page.getByRole("radio", { name: /Solana/ });
    await sol.click();
    await expect(sol).toHaveAttribute("aria-checked", "true");
    await page.getByRole("tab", { name: "New Tokens" }).click();
    await expect(page.getByRole("tab", { name: "New Tokens" })).toHaveAttribute("aria-selected", "true");
  });

  test("live ticker connects to the price stream", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Live", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  });

  test("global search finds tokens", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    await page.getByRole("textbox", { name: "Search" }).fill("bonk");
    await expect(page.getByText("On-chain tokens")).toBeVisible({ timeout: 20_000 });
  });

  test("theme toggle switches and persists light mode", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Switch to light mode/ }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("shows an honest error instead of stale prices when market data fails", async ({ page }) => {
    await page.route("**/api/market/coins**", (r) => r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "api.coingecko.com unavailable (503)" }) }));
    await page.goto("/");
    await page.getByRole("radio", { name: /Ethereum/ }).click();
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
  test("wallet picker never asks for a seed phrase and lists upcoming BAJAR Wallet", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("BAJAR Wallet")).toBeVisible();
    await expect(dialog.getByText("Coming soon")).toBeVisible();
    await expect(dialog.getByText("Phantom")).toBeVisible();
    await expect(dialog.getByText("MetaMask")).toBeVisible();
    await expect(dialog.getByText(/seed phrase or private key/)).toBeVisible();
  });

  test("connects and disconnects an injected Solana wallet", async ({ page }) => {
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
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
    await expect(page.getByRole("button", { name: /9WzD…AWWM/ }).first()).toBeVisible();
    await page.getByRole("button", { name: /9WzD…AWWM/ }).first().click();
    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("button", { name: "Connect wallet" }).first()).toBeVisible();
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

test.describe("mobile @mobile", () => {
  test("homepage has no horizontal overflow on phones @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Open Crypto Marketplace/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

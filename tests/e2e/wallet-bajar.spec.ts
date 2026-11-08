import { expect, test } from "@playwright/test";

// Standard BIP-39 test vector. Never fund it.
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

test.describe("BAJAR Wallet", () => {
  test.setTimeout(120_000);

  test("import, receive addresses, lock and unlock", async ({ page }) => {
    await page.goto("/wallet");
    await page.getByRole("tab", { name: "Import phrase" }).click();
    await page.getByTestId("bajar-import-phrase").fill(PHRASE);
    await page.getByTestId("bajar-password").fill("correct horse battery");
    await page.getByTestId("bajar-password2").fill("correct horse battery");
    await page.getByTestId("bajar-import").click();
    await expect(page.getByTestId("bajar-lock")).toBeVisible({ timeout: 60_000 });

    await page.getByRole("tab", { name: /Receive/ }).click();
    await expect(page.getByTestId("bajar-addr-bitcoin")).toHaveText("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    await expect(page.getByTestId("bajar-addr-ethereum")).toHaveText("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    await expect(page.getByTestId("bajar-addr-solana")).toHaveText("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");

    await page.getByTestId("bajar-lock").click();
    await expect(page.getByTestId("bajar-unlock")).toBeVisible();
    await page.getByTestId("bajar-password").fill("wrong password!!");
    await page.getByTestId("bajar-unlock").click();
    await expect(page.getByText(/password|decrypt/i).first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("bajar-password").fill("correct horse battery");
    await page.getByTestId("bajar-unlock").click();
    await expect(page.getByTestId("bajar-lock")).toBeVisible({ timeout: 60_000 });
  });

  test("hybrid sign-in requires approval and verifies both signatures", async ({ page }) => {
    await page.goto("/wallet");
    await page.getByRole("tab", { name: "Import phrase" }).click();
    await page.getByTestId("bajar-import-phrase").fill(PHRASE);
    await page.getByTestId("bajar-password").fill("correct horse battery");
    await page.getByTestId("bajar-password2").fill("correct horse battery");
    await page.getByTestId("bajar-import").click();
    await expect(page.getByTestId("bajar-lock")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: /Security/ }).click();
    await page.getByTestId("bajar-hybrid-signin").click();
    await expect(page.getByTestId("bajar-approval")).toBeVisible();
    await page.getByTestId("bajar-approve").click();
    await expect(page.getByTestId("bajar-hybrid-result")).toContainText("both signatures verified", { timeout: 20_000 });
  });
});

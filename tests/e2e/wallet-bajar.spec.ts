import { expect, test, type Page } from "@playwright/test";

// Standard BIP-39 test vector. Never fund it.
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PASSWORD = "orbit-lantern-quiet-maple-29";

async function importTestWallet(page: Page) {
  await page.goto("/wallet");
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.getByTestId("bajar-import-phrase").fill(PHRASE);
  await expect(page.getByText("publicly known test phrase")).toBeVisible();
  await expect(page.getByTestId("bajar-import-next")).toBeDisabled();
  await page.getByTestId("bajar-ack-public").check();
  await page.getByTestId("bajar-import-next").click();
  await page.getByTestId("bajar-password").fill(PASSWORD);
  await page.getByTestId("bajar-password2").fill(PASSWORD);
  await page.getByTestId("bajar-pw-ack").check();
  await page.getByTestId("bajar-pw-next").click();
  await expect(page.getByTestId("bajar-done")).toBeVisible({ timeout: 60_000 });
}

test.describe("Bajar Wallet", () => {
  test.setTimeout(150_000);

  test("create: password policy, phrase reveal, word quiz, done", async ({ page }) => {
    await page.goto("/wallet");
    await page.getByTestId("bajar-start").click();
    // Weak password is refused.
    await page.getByTestId("bajar-password").fill("password123456");
    await page.getByTestId("bajar-password2").fill("password123456");
    await page.getByTestId("bajar-pw-ack").check();
    await expect(page.getByTestId("bajar-pw-next")).toBeDisabled();
    await page.getByTestId("bajar-password").fill(PASSWORD);
    await page.getByTestId("bajar-password2").fill(PASSWORD);
    await page.getByTestId("bajar-pw-next").click();
    // Phrase is hidden until revealed; continue needs reveal + confirmation.
    await expect(page.getByTestId("bajar-phrase-next")).toBeDisabled();
    await page.getByTestId("bajar-reveal").click();
    const words = (await page.getByTestId("bajar-phrase").locator("li").allInnerTexts()).map((t) => t.replace(/^\d+\.\s*/, "").trim());
    expect(words).toHaveLength(12);
    await page.getByTestId("bajar-written").check();
    await page.getByTestId("bajar-phrase-next").click();
    // Quiz: pick the right word for each asked position.
    const quizzes = page.locator("[data-testid^='bajar-quiz-']");
    for (let i = 0; i < (await quizzes.count()); i++) {
      const q = quizzes.nth(i);
      const pos = Number((await q.getAttribute("data-testid"))!.split("-").pop());
      await q.getByRole("button", { name: words[pos], exact: true }).click();
    }
    await page.getByTestId("bajar-create").click();
    await expect(page.getByTestId("bajar-done")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Recovery phrase verified")).toBeVisible();
  });

  test("import, receive addresses, wrong-password throttling, unlock", async ({ page }) => {
    await importTestWallet(page);
    await page.getByTestId("bajar-open").click();
    await page.getByRole("tab", { name: /Receive/ }).click();
    await expect(page.getByTestId("bajar-addr-bitcoin")).toHaveText("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    await expect(page.getByTestId("bajar-addr-ethereum")).toHaveText("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    await expect(page.getByTestId("bajar-addr-solana")).toHaveText("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");

    await page.getByTestId("bajar-lock").click();
    for (let i = 0; i < 3; i++) {
      await page.getByTestId("bajar-password").fill(`wrong password ${i}`);
      await page.getByTestId("bajar-unlock").click();
      await expect(page.getByText(/Wrong password/).first()).toBeVisible({ timeout: 30_000 });
    }
    await expect(page.getByTestId("bajar-throttle")).toBeVisible();
    await expect(page.getByTestId("bajar-unlock")).toBeDisabled();
    // Clear the timed lock (test only) and unlock with the right password.
    await page.evaluate(() => localStorage.removeItem("bajar.unlock.v1"));
    await page.reload();
    await page.getByTestId("bajar-password").fill(PASSWORD);
    await page.getByTestId("bajar-unlock").click();
    await expect(page.getByTestId("bajar-lock")).toBeVisible({ timeout: 60_000 });
  });

  test("hybrid sign-in requires approval and verifies both signatures", async ({ page }) => {
    await importTestWallet(page);
    await page.getByTestId("bajar-done-signin").click();
    await expect(page.getByTestId("bajar-approval")).toBeVisible();
    await page.getByTestId("bajar-approve").click();
    await expect(page.getByTestId("bajar-signin-ok")).toContainText("both signatures verified", { timeout: 20_000 });
  });

  test("send screen screens a known-malicious recipient", async ({ page }) => {
    await importTestWallet(page);
    await page.getByTestId("bajar-open").click();
    await page.getByRole("tab", { name: /Security/ }).click();
    await expect(page.getByTestId("bajar-checkup")).toBeVisible();
    await page.getByRole("tab", { name: /Send/ }).click();
    await page.locator("select").first().waitFor({ timeout: 30_000 }).catch(() => {});
    const evmAsset = page.locator("select option", { hasText: /Ethereum|Base|Arbitrum|Polygon|BNB|Optimism|Avalanche/ }).first();
    test.skip(!(await evmAsset.count()), "test wallet has no funded EVM asset right now");
    await page.locator("select").first().selectOption({ label: (await evmAsset.textContent())! });
    await page.getByPlaceholder("0x…").fill("0x098B716B8Aaf21512996dC57EB0615e2383E2f96");
    await expect(page.getByTestId("bajar-recipient-check")).toContainText("Reported as malicious", { timeout: 20_000 });
  });
});

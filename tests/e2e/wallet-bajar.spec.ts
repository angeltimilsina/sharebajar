import { expect, test, type Page } from "@playwright/test";

// Standard BIP-39 test vector. Never fund it.
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PASSWORD = "orbit-lantern-quiet-maple-29";

// How phrases arrive from notes apps: numbered lines, an invisible zero-width space, stray capitals.
const MESSY = PHRASE.split(" ").map((w, i) => `${i + 1}. ${i === 0 ? "Abandon" : w}`).join("\n").replace("\n5.", "\u200B\n5.");

async function importTestWallet(page: Page, text = PHRASE) {
  await page.goto("/wallet");
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.getByTestId("bajar-import-phrase").fill(text);
  await expect(page.getByText("12 / 12 words")).toBeVisible();
  await expect(page.getByText("Checksum OK")).toBeVisible();
  await expect(page.getByText("publicly known test phrase")).toBeVisible();
  await expect(page.getByTestId("bajar-import-next")).toBeDisabled();
  await page.getByTestId("bajar-ack-public").check();
  await page.getByTestId("bajar-import-next").click();
  await expect(page.getByText("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).toBeVisible();
  await page.getByTestId("bajar-accounts-next").click();
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
    await importTestWallet(page, MESSY);
    await page.getByTestId("bajar-open").click();
    // Dashboard: only the three tabs that matter; Send/Receive/Swap are actions.
    await expect(page.getByTestId("wallet-dashboard").getByRole("tab")).toHaveText(["Portfolio", "Activity", "Settings"]);
    await expect(page.getByTestId("wallet-holdings")).toBeVisible();
    await expect(page.locator(".site-footer")).toBeHidden(); // app view: no footer
    await expect(page.getByTestId("wallet-insights")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("wallet-action-receive").click();
    await expect(page).toHaveURL(/#receive$/);
    await expect(page.getByTestId("bajar-addr-bitcoin")).toHaveText("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    await expect(page.getByTestId("bajar-addr-ethereum")).toHaveText("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    await expect(page.getByTestId("bajar-addr-solana")).toHaveText("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
    // Back (button or phone back) returns to the dashboard.
    await page.getByTestId("wallet-back").click();
    await expect(page.getByTestId("wallet-holdings")).toBeVisible();

    await page.getByTestId("bajar-lock").click();
    await expect(page.locator(".site-footer")).toBeHidden(); // the wallet is an app page: no footer even when locked
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

  test("import grid: word-by-word typing, typo flag, suggestions, 24-word switch", async ({ page }) => {
    await page.goto("/wallet");
    await page.getByRole("tab", { name: "Import", exact: true }).click();
    const first = page.getByTestId("bajar-import-phrase");
    await first.pressSequentially("abandn ");
    await expect(page.getByText(/not in the BIP-39 list/)).toBeVisible();
    await first.fill("");
    await first.pressSequentially("aband");
    await page.getByRole("button", { name: "abandon", exact: true }).click();
    await expect(page.getByTestId("bajar-word-1")).toBeFocused();
    await page.getByTestId("bajar-len-24").click();
    await expect(page.getByTestId("bajar-word-23")).toBeVisible();
    await expect(page.getByText("1 / 24 words")).toBeVisible();
  });

  test("hybrid sign-in requires approval and verifies both signatures", async ({ page }) => {
    await importTestWallet(page);
    await page.getByTestId("bajar-signup-name").fill("Test Student");
    await page.getByTestId("bajar-done-signin").click();
    await expect(page.getByTestId("bajar-approval")).toBeVisible();
    await page.getByTestId("bajar-approve").click();
    await expect(page.getByTestId("bajar-signin-ok")).toContainText("Signed up as Test Student · both signatures verified", { timeout: 20_000 });
    const acct = await page.evaluate(() => fetch("/api/account").then((r) => r.json()));
    expect(acct.account?.name).toBe("Test Student");
  });

  test("send screen screens a known-malicious recipient", async ({ page }) => {
    await importTestWallet(page);
    await page.getByTestId("bajar-open").click();
    await page.getByRole("tab", { name: /Settings/ }).click();
    await expect(page.getByTestId("bajar-checkup")).toBeVisible();
    await page.getByRole("tab", { name: /Portfolio/ }).click();
    await page.getByTestId("wallet-action-send").click();
    await page.locator("select").first().waitFor({ timeout: 30_000 }).catch(() => {});
    const evmAsset = page.locator("select option", { hasText: /Ethereum|Base|Arbitrum|Polygon|BNB|Optimism|Avalanche/ }).first();
    test.skip(!(await evmAsset.count()), "test wallet has no funded EVM asset right now");
    await page.locator("select").first().selectOption({ label: (await evmAsset.textContent())! });
    await page.getByPlaceholder("0x…").fill("0x098B716B8Aaf21512996dC57EB0615e2383E2f96");
    await expect(page.getByTestId("bajar-recipient-check")).toContainText("Reported as malicious", { timeout: 20_000 });
  });
});

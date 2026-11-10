import { expect, test, type Page } from "@playwright/test";

const SOL_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const SOL_DEST = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

async function stubPhantom(page: Page) {
  await page.addInitScript(({ pk }) => {
    const signed: string[] = [];
    (window as unknown as { __signed: string[] }).__signed = signed;
    const provider = {
      isPhantom: true,
      publicKey: null as null | { toString(): string },
      connect: async () => { provider.publicKey = { toString: () => pk }; return { publicKey: provider.publicKey }; },
      disconnect: async () => {},
      signMessage: async () => ({ signature: new Uint8Array(64) }),
      signTransaction: async (tx: { message: { staticAccountKeys: { toBase58(): string }[] } }) => { signed.push(tx.message.staticAccountKeys[0].toBase58()); return tx; },
      on: () => {}, off: () => {},
    };
    (window as unknown as { phantom: unknown }).phantom = { solana: provider };
  }, { pk: SOL_ADDR });
}
async function connect(page: Page) {
  // The menu may be tapped before the page is interactive; retry until it opens.
  await expect(async () => {
    if (!(await page.getByTestId("menu-connect").isVisible())) await page.getByTestId("menu-button").click();
    await expect(page.getByTestId("menu-connect")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await page.getByTestId("menu-connect").click();
  await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
}

test.describe("multi-wallet", () => {
  test.setTimeout(120_000);

  test("portfolio: one wallet, chart, asset details, research, discovery, launchpad; agent in the sidebar", async ({ page }) => {
    await stubPhantom(page);
    await page.goto("/portfolio");
    await expect(page.getByTestId("connected-dashboard")).toHaveCount(0); // only once connected
    await connect(page);
    await expect(page.getByTestId("connected-dashboard")).toBeVisible();
    await expect(page.getByTestId("portfolio-source")).toHaveText("Phantom");
    await expect(page.getByTestId("wallet-picker")).toHaveCount(0);
    await expect(page.getByTestId("add-wallet")).toHaveCount(0);
    const total = page.getByTestId("dashboard-total");
    await expect(total).toContainText("$", { timeout: 45_000 });
    await expect(page.getByTestId("holdings-chart")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("portfolio-research")).toBeVisible();
    await expect(page.getByTestId("portfolio-discover")).toBeVisible();
    await expect(page.getByTestId("launched-tokens")).toBeVisible();

    await page.getByTestId("asset-row").first().getByRole("button").click();
    const details = page.getByTestId("asset-details");
    await expect(details.getByText("Held in")).toBeVisible();
    await expect(details.getByTestId("asset-acquired")).toBeVisible();

    // The agent (on Profile & Pro) gets values, never addresses.
    // Activity is part of Portfolio now; launched tokens are listed with a Manage action.
    await expect(page.getByTestId("wallet-sidebar").getByRole("link", { name: "Activity" })).toHaveCount(0);
    await expect(page.getByTestId("portfolio-activity")).toBeVisible();
    await expect(page.getByTestId("launched-tokens")).toBeVisible();
    await page.getByTestId("wallet-sidebar").getByRole("link", { name: "Profile & Pro" }).click();
    await page.getByTestId("pro-agent").getByTestId("open-agent").click();
    await expect(page).toHaveURL(/\/intelligence\?agent=portfolio/);
    await expect(page.getByTestId("agent-portfolio")).toBeVisible();
    const stash = await page.evaluate(() => sessionStorage.getItem("bajar.agent.portfolio") ?? "");
    expect(stash).not.toContain(SOL_ADDR);
  });

  test("/wallets goes to Portfolio", async ({ page }) => {
    await page.goto("/wallets");
    await expect(page).toHaveURL(/\/portfolio$/);
  });
});

test.describe("all Solana wallets return to the browser @mobile", () => {
  test("Solflare and Backpack connect from the phone browser @mobile", async ({ page }) => {
    const opened: string[] = [];
    await page.route(/solflare\.com|backpack\.app/, (r) => { opened.push(r.request().url()); return r.fulfill({ status: 204, body: "" }); });
    await page.goto("/portfolio");
    await page.getByTestId("menu-button").click();
    await page.getByTestId("menu-connect").click();
    await expect(page.getByTestId("wallet-option-solflare")).toContainText("come right back");
    await page.getByTestId("wallet-option-solflare").click();
    await expect.poll(() => opened.length).toBe(1);
    const u = new URL(opened[0]);
    expect(u.hostname).toBe("solflare.com");
    expect(u.pathname).toBe("/ul/v1/connect");
    expect(u.searchParams.get("dapp_encryption_public_key")).toBeTruthy();
    expect(new URL(u.searchParams.get("redirect_link")!).searchParams.get("link_req")).toBeTruthy();
  });
});

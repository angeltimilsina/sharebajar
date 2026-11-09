import { expect, test, type Page } from "@playwright/test";

const SOL_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const SOL_DEST = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_WATCH = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

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

  test("portfolio: wallet picker, holdings chart, asset details, agent in the sidebar", async ({ page }) => {
    await stubPhantom(page);
    await page.addInitScript((addr) => localStorage.setItem("bajar.wallets.v1", JSON.stringify([{ id: `evm:${addr.toLowerCase()}`, address: addr, chain: "evm", label: "Cold storage", source: "watch", addedAt: 1 }])), EVM_WATCH);
    await page.goto("/portfolio");
    await expect(page.getByTestId("connected-dashboard")).toHaveCount(0); // only once connected
    await connect(page);
    await expect(page.getByTestId("connected-dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Portfolio", level: 1 })).toHaveCount(0);
    await expect(page.getByText("Move between wallets")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-wallet-count")).toContainText("1 wallet connected · 1 watch-only");
    const total = page.getByTestId("dashboard-total");
    await expect(total).toContainText("$", { timeout: 45_000 });
    await expect(page.getByTestId("holdings-chart")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("allocation")).toBeVisible();

    // Asset details: price, amounts, per-wallet holdings, first received.
    await page.getByTestId("asset-row").first().getByRole("button").click();
    const details = page.getByTestId("asset-details");
    await expect(details).toBeVisible();
    await expect(details.getByText("Held in")).toBeVisible();
    await expect(details.getByTestId("asset-acquired")).toBeVisible();

    // Picker: toggling a source changes the total; the last source can't be turned off.
    const before = await total.innerText();
    await page.getByTestId("wallet-picker").click();
    const sources = page.getByTestId("wallet-source");
    await expect(sources).toHaveCount(2);
    await sources.filter({ hasText: "Cold storage" }).click();
    await expect(sources.filter({ hasText: "Cold storage" })).toHaveAttribute("aria-checked", "false");
    await sources.filter({ hasText: "Phantom" }).click(); // would leave nothing selected → ignored
    await expect(sources.filter({ hasText: "Phantom" })).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("wallet-sheet").getByRole("button", { name: "Done" }).click();
    await expect(total).not.toHaveText(before);

    // The agent lives in the sidebar and gets values, never addresses.
    await page.getByTestId("open-agent").click();
    await expect(page).toHaveURL(/\/intelligence\?agent=portfolio/);
    await expect(page.getByTestId("agent-portfolio")).toBeVisible();
    const stash = await page.evaluate(() => sessionStorage.getItem("bajar.agent.portfolio") ?? "");
    expect(stash).not.toContain(SOL_ADDR);
    expect(stash.toLowerCase()).not.toContain(EVM_WATCH.toLowerCase());
  });

  test("portfolio: + adds a watch-only address; /wallets goes to Portfolio", async ({ page }) => {
    await stubPhantom(page);
    await page.goto("/wallets");
    await expect(page).toHaveURL(/\/portfolio$/);
    await connect(page);
    await page.getByTestId("add-wallet").click();
    await page.getByLabel("Watch address").fill(SOL_DEST);
    await page.getByLabel("Watch name").fill("Savings");
    await page.getByTestId("watch-add").click();
    await expect(page.getByTestId("dashboard-wallet-count")).toContainText("1 watch-only");
    await page.getByTestId("wallet-picker").click();
    await expect(page.getByTestId("wallet-source").filter({ hasText: "Savings" })).toBeVisible();
    await expect(page.getByTestId("wallet-sidebar").getByText("Wallets & transfers")).toHaveCount(0);
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

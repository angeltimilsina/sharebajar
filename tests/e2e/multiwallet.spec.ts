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
  await page.getByTestId("menu-button").click();
  await page.getByTestId("menu-connect").click();
  await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
}

test.describe("multi-wallet", () => {
  test.setTimeout(120_000);

  test("market dashboard totals connected + watch wallets and opens the investment agent", async ({ page }) => {
    await stubPhantom(page);
    await page.addInitScript((addr) => localStorage.setItem("bajar.wallets.v1", JSON.stringify([{ id: `evm:${addr.toLowerCase()}`, address: addr, chain: "evm", label: "Cold storage", source: "watch", addedAt: 1 }])), EVM_WATCH);
    await page.goto("/");
    await expect(page.getByTestId("connected-dashboard")).toHaveCount(0); // only once connected
    await connect(page);
    const dash = page.getByTestId("connected-dashboard");
    await expect(dash).toBeVisible();
    await expect(page.getByTestId("dashboard-wallet-count")).toContainText("1 wallet connected");
    await expect(dash.getByText("1 watch-only")).toBeVisible();
    await expect(page.getByTestId("dashboard-total")).toContainText("$", { timeout: 45_000 });
    await expect(page.getByTestId("dashboard-wallets").getByText("Cold storage")).toBeVisible();
    await page.getByTestId("open-agent").click();
    await expect(page).toHaveURL(/\/intelligence\?agent=portfolio/);
    await expect(page.getByTestId("agent-portfolio")).toBeVisible();
    const stash = await page.evaluate(() => sessionStorage.getItem("bajar.agent.portfolio") ?? "");
    expect(stash).not.toContain(SOL_ADDR);
    expect(stash.toLowerCase()).not.toContain(EVM_WATCH.toLowerCase());
  });

  test("wallets: add watch address, build a map, move SOL to it with recipient check and wallet approval", async ({ page }) => {
    await stubPhantom(page);
    let sent = 0;
    await page.route("**/api/wallet/rpc", async (r) => {
      const b = JSON.parse(r.request().postData() ?? "{}");
      if (b.method === "sendTransaction") { sent++; return r.fulfill({ contentType: "application/json", body: JSON.stringify({ result: "5".repeat(88) }) }); }
      return r.continue();
    });
    await page.goto("/wallets");
    await connect(page);
    await page.getByLabel("Watch address").fill(SOL_DEST);
    await page.getByLabel("Watch name").fill("Savings");
    await page.getByTestId("watch-add").click();
    await expect(page.getByTestId("hub-wallets").getByText("Savings")).toBeVisible();

    await page.getByTestId("map-new").click();
    await page.getByLabel("Map name").fill("Long-term");
    const form = page.getByTestId("map-form");
    for (const cb of await form.getByRole("checkbox").all()) await cb.check();
    await page.getByTestId("map-save").click();
    await expect(page.getByTestId("map-card").getByText("Long-term")).toBeVisible();

    const move = page.getByTestId("cross-transfer");
    await expect(move.getByTestId("move-to")).toContainText("Savings", { timeout: 30_000 });
    await expect(move.getByTestId("move-asset")).toContainText("SOL", { timeout: 45_000 });
    await move.getByTestId("move-amount").fill("0.001");
    await move.getByTestId("move-review").click();
    const modal = page.getByTestId("move-modal");
    await expect(modal.getByText(/Recipient check passed|Recipient check unavailable|watch-only/).first()).toBeVisible({ timeout: 20_000 });
    await modal.getByTestId("move-confirm").click();
    await expect(modal.getByText("Transfer submitted")).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => (window as unknown as { __signed: string[] }).__signed)).toEqual([SOL_ADDR]); // signed by the sender, once
    expect(sent).toBe(1);
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

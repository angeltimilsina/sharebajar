import { expect, test, type Page, type Route } from "@playwright/test";
import nacl from "tweetnacl";
import bs58 from "bs58";

/*
 * Phone browser ↔ Phantom app, over Phantom's deep-link protocol. The test
 * plays Phantom: it decrypts what Bajar sends and redirects back with
 * encrypted replies, exactly as the app would.
 */
const SOL_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const phantom = nacl.box.keyPair();

function captureNext(page: Page, method: string): Promise<URL> {
  return new Promise((resolve) => {
    const re = new RegExp(`phantom\\.app/ul/v1/${method}`);
    const handler = (route: Route) => { resolve(new URL(route.request().url())); route.fulfill({ status: 204, body: "" }); page.unroute(re, handler); };
    page.route(re, handler);
  });
}
function reply(redirect: string, dappPub: string, body: object, opts: { includeKey?: boolean } = {}) {
  const nonce = nacl.randomBytes(24);
  const shared = nacl.box.before(bs58.decode(dappPub), phantom.secretKey);
  const data = nacl.box.after(new TextEncoder().encode(JSON.stringify(body)), nonce, shared);
  const u = new URL(redirect);
  if (opts.includeKey) u.searchParams.set("phantom_encryption_public_key", bs58.encode(phantom.publicKey));
  u.searchParams.set("nonce", bs58.encode(nonce));
  u.searchParams.set("data", bs58.encode(data));
  return u.toString();
}
function openPayload(u: URL, dappPub: string) {
  const shared = nacl.box.before(bs58.decode(dappPub), phantom.secretKey);
  const opened = nacl.box.open.after(bs58.decode(u.searchParams.get("payload")!), bs58.decode(u.searchParams.get("nonce")!), shared);
  return JSON.parse(new TextDecoder().decode(opened!));
}
async function connectPhantom(page: Page, start = "/portfolio") {
  await page.goto(start);
  await page.getByTestId("menu-button").click();
  await page.getByTestId("menu-connect").click();
  const req = captureNext(page, "connect");
  await page.getByTestId("wallet-option-phantom").click();
  const u = await req;
  const dappPub = u.searchParams.get("dapp_encryption_public_key")!;
  const redirect = u.searchParams.get("redirect_link")!;
  expect(u.searchParams.get("app_url")).toMatch(/^http/);
  expect(new URL(redirect).searchParams.get("link_req")).toBeTruthy();
  await page.goto(reply(redirect, dappPub, { public_key: SOL_ADDR, session: "test-session" }, { includeKey: true }));
  return dappPub;
}

test.describe("Phantom deep links @mobile", () => {
  test.setTimeout(120_000);

  test("connects from the phone browser and returns here @mobile", async ({ page }) => {
    await connectPhantom(page);
    await expect(page.getByTestId("connected-dashboard")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("mobile-wallet").click(); // connected: opens the Account sheet
    await expect(page.getByTestId("account-panel").getByText(/Phantom · Solana/)).toBeVisible();
    await expect(page).not.toHaveURL(/link_req|nonce|data=/); // reply stripped from the address bar
  });

  test("rejects a forged reply that doesn't match a request @mobile", async ({ page }) => {
    await page.goto("/portfolio");
    const fake = new URL(page.url());
    fake.searchParams.set("link_req", "forged");
    fake.searchParams.set("phantom_encryption_public_key", bs58.encode(phantom.publicKey));
    fake.searchParams.set("nonce", bs58.encode(nacl.randomBytes(24)));
    fake.searchParams.set("data", bs58.encode(nacl.randomBytes(64)));
    await page.goto(fake.toString());
    await expect(page.getByText(/doesn't match a request from this browser/).first()).toBeVisible();
    await expect(page.getByText(/Phantom · Solana/)).toHaveCount(0);
  });

  test("swap: Phantom signs, Bajar re-verifies and submits on return; rejection sends nothing @mobile", async ({ page }) => {
    const dappPub = await connectPhantom(page, `/token/solana/${BONK}?mode=swap`);
    let executed = 0;
    await page.route("**/api/swap/execute", (r) => { executed++; return r.fulfill({ contentType: "application/json", body: JSON.stringify({ signature: "5".repeat(88) }) }); });
    await page.route("**/api/wallet/rpc", async (r) => {
      const b = JSON.parse(r.request().postData() ?? "{}");
      if (b.method === "sendTransaction") { executed++; return r.fulfill({ contentType: "application/json", body: JSON.stringify({ result: "5".repeat(88) }) }); }
      return r.continue();
    });

    const runSwap = async () => {
      const exec = page.getByTestId("asset-execution");
      await exec.getByLabel("Amount to pay").fill("0.01");
      await exec.getByRole("button", { name: /Review swap/ }).click({ timeout: 45_000 });
      const req = captureNext(page, "signTransaction");
      await page.getByRole("button", { name: "Confirm in wallet" }).click({ timeout: 45_000 });
      return req;
    };

    // 1) Reject in Phantom → nothing sent.
    let u = await runSwap();
    const rejected = new URL(u.searchParams.get("redirect_link")!);
    rejected.searchParams.set("errorCode", "4001");
    rejected.searchParams.set("errorMessage", "User rejected the request.");
    await page.goto(rejected.toString());
    await expect(page.getByText(/rejected the request in Phantom\. Nothing was sent/).first()).toBeVisible();
    expect(executed).toBe(0);

    // 2) Approve → Bajar receives the signed transaction, re-verifies it and submits.
    u = await runSwap();
    const payload = openPayload(u, u.searchParams.get("dapp_encryption_public_key")!);
    expect(payload.session).toBe("test-session");
    expect(typeof payload.transaction).toBe("string");
    await page.goto(reply(u.searchParams.get("redirect_link")!, dappPub, { transaction: payload.transaction }));
    await expect(page.getByText(/Swap submitted/).first()).toBeVisible({ timeout: 20_000 });
    expect(executed).toBe(1);
  });
});

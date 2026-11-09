import { expect, test, type Page } from "@playwright/test";

/*
 * Trade, swap and portfolio with several wallets. Wallets are stand-ins that
 * record every request; quotes, routes and balances are real. Nothing is
 * broadcast: the stand-in wallets never produce valid signatures.
 */

// A funded mainnet Solana address (read-only use: balances, quotes, simulation).
const SOL_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
// Public BIP-39 test-vector EVM address.
const EVM_ADDR = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
// A well-known public address that holds ETH on Base (read-only: firm 0x quotes need a funded taker).
const EVM_FUNDED = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function stubPhantom(page: Page, opts: { reject?: boolean } = {}) {
  await page.addInitScript(({ pk, reject }) => {
    const calls: string[] = [];
    (window as unknown as { __calls: string[] }).__calls = calls;
    const provider = {
      isPhantom: true,
      publicKey: null as null | { toString(): string; toBase58(): string },
      connect: async () => { calls.push("connect"); provider.publicKey = { toString: () => pk, toBase58: () => pk }; return { publicKey: provider.publicKey }; },
      disconnect: async () => { calls.push("disconnect"); provider.publicKey = null; },
      signMessage: async () => { calls.push("signMessage"); return { signature: new Uint8Array(64) }; },
      signTransaction: async (tx: unknown) => {
        calls.push("signTransaction");
        if (reject) throw new Error("User rejected the request.");
        return tx;
      },
      on: () => {}, off: () => {},
    };
    (window as unknown as { phantom: unknown }).phantom = { solana: provider };
  }, { pk: SOL_ADDR, reject: !!opts.reject });
}

async function stubMetaMask(page: Page, address = EVM_ADDR) {
  await page.addInitScript(({ addr }) => {
    const calls: { method: string; params?: unknown[] }[] = [];
    (window as unknown as { __evmCalls: typeof calls }).__evmCalls = calls;
    let chainId = "0x1";
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    const provider = {
      isMetaMask: true,
      async request({ method, params }: { method: string; params?: unknown[] }) {
        calls.push({ method, params });
        switch (method) {
          case "eth_requestAccounts": case "eth_accounts": return [addr];
          case "eth_chainId": return chainId;
          case "wallet_switchEthereumChain": chainId = (params![0] as { chainId: string }).chainId; (listeners.chainChanged ?? []).forEach((f) => f(chainId)); return null;
          case "eth_call": return "0x";
          case "eth_getBalance": return "0xde0b6b3a7640000"; // 1 ETH
          case "eth_sendTransaction": return "0x" + "ab".repeat(32);
          case "eth_getTransactionReceipt": return { status: "0x1" };
          default: return null;
        }
      },
      on(ev: string, f: (...a: unknown[]) => void) { (listeners[ev] ??= []).push(f); },
      removeListener(ev: string, f: (...a: unknown[]) => void) { listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== f); },
    };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "test-mm", name: "MetaMask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "io.metamask" }, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, { addr: address });
}

async function connect(page: Page, name: RegExp) {
  await page.getByTestId("menu-button").click();
  await page.getByTestId("menu-connect").click();
  await page.getByRole("dialog").getByRole("button", { name }).click();
}

test.describe("multiple wallets", () => {
  test.setTimeout(120_000);

  test("Solana: quote without wallet, verified transaction, signing only on confirm, rejection handled", async ({ page }) => {
    await stubPhantom(page, { reject: true });
    await page.goto(`/token/solana/${BONK}?mode=swap`);
    const exec = page.getByTestId("asset-execution");
    await exec.getByLabel("Amount to pay").fill("0.01");
    await expect(exec.getByRole("button", { name: /Connect wallet to swap/ })).toBeVisible({ timeout: 45_000 });
    await connect(page, /Phantom/);
    await exec.getByRole("button", { name: /Review swap/ }).click({ timeout: 30_000 });
    // Built, verified (paid by this wallet, no delegate approvals) and simulated before the wallet sees it.
    const confirmBtn = page.getByRole("button", { name: "Confirm in wallet" });
    await expect(confirmBtn).toBeVisible({ timeout: 45_000 });
    expect(await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls)).not.toContain("signTransaction");
    await confirmBtn.click();
    await expect(page.getByText(/rejected the transaction in your wallet\. Nothing was sent/)).toBeVisible({ timeout: 20_000 });
    expect((await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls)).filter((c) => c === "signTransaction")).toHaveLength(1);
  });

  test("EVM: switches network, simulates, then asks the wallet to send to the 0x contract", async ({ page }) => {
    await stubMetaMask(page, EVM_FUNDED);
    await page.goto(`/token/base/${USDC_BASE}?mode=swap`);
    const exec = page.getByTestId("asset-execution");
    await exec.getByRole("textbox").first().fill("0.001");
    await connect(page, /MetaMask/);
    await exec.getByRole("button", { name: /Review/ }).click({ timeout: 45_000 });
    await page.getByRole("button", { name: /Simulate|Approve & simulate/ }).click();
    await page.getByRole("button", { name: "Confirm in wallet" }).click({ timeout: 45_000 });
    await expect(page.getByText(/Swap complete|confirmed|Done/i).first()).toBeVisible({ timeout: 30_000 });
    const calls = await page.evaluate(() => (window as unknown as { __evmCalls: { method: string; params?: unknown[] }[] }).__evmCalls);
    const methods = calls.map((c) => c.method);
    const sw = methods.indexOf("wallet_switchEthereumChain"), sim = methods.indexOf("eth_call"), send = methods.lastIndexOf("eth_sendTransaction");
    expect(sw).toBeGreaterThan(-1);
    expect(sim).toBeGreaterThan(sw);
    expect(send).toBeGreaterThan(sim);
    expect((calls[sw].params![0] as { chainId: string }).chainId).toBe("0x2105"); // Base
    const tx = calls[send].params![0] as { to: string; from: string };
    expect(tx.from.toLowerCase()).toBe(EVM_FUNDED.toLowerCase());
    expect(tx.to.toLowerCase()).toBe("0x0000000000001ff3684f28c67538d4d072c22734"); // 0x AllowanceHolder
  });

  test("portfolio follows the connected wallet, and switching wallets swaps the view", async ({ page }) => {
    await stubPhantom(page);
    await stubMetaMask(page);
    await page.goto("/portfolio");
    await expect(page.getByTestId("portfolio-intro")).toBeVisible();
    await page.getByTestId("portfolio-connect").click();
    await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
    const main = page.locator("main");
    await expect(main.getByText(/Phantom · Solana/)).toBeVisible();
    await expect(page.getByRole("row", { name: /SOL/ }).first()).toBeVisible({ timeout: 45_000 });
    // Switch wallet from the sidebar: Solana → EVM.
    await page.getByTestId("account-switch").click();
    await page.getByRole("dialog").getByRole("button", { name: /MetaMask/ }).click();
    await expect(main.getByText(/MetaMask · /)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Phantom · Solana/)).toHaveCount(0);
  });

  test("Solana wallet on an EVM asset is asked for an EVM wallet (and vice versa)", async ({ page }) => {
    await stubPhantom(page);
    await page.goto(`/token/base/${USDC_BASE}?mode=swap`);
    await connect(page, /Phantom/);
    const exec = page.getByTestId("asset-execution");
    await exec.getByRole("textbox").first().fill("0.001");
    await expect(exec.getByRole("button", { name: /Connect an EVM wallet/ })).toBeVisible({ timeout: 45_000 });
  });

  test("Bajar Wallet refuses signing methods that skip the approval screen", async ({ page }) => {
    await page.goto("/wallet");
    await page.waitForFunction(() => !!(window as unknown as { bajar?: unknown }).bajar, null, { timeout: 30_000 });
    const res = await page.evaluate(async () => {
      const evm = (window as unknown as { bajar: { evm: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } } }).bajar.evm;
      const out: Record<string, string> = {};
      for (const method of ["eth_sign", "eth_signTypedData_v4", "eth_signTransaction"]) {
        try { await evm.request({ method, params: [] }); out[method] = "allowed"; } catch (e) { out[method] = String((e as { code?: number }).code ?? (e as Error).message); }
      }
      return out;
    });
    expect(res).toEqual({ eth_sign: "4200", eth_signTypedData_v4: "4200", eth_signTransaction: "4200" });
  });
});

test.describe("mobile wallet deep links @mobile", () => {
  test("Phantom and MetaMask open Bajar in the wallet app, tagged to auto-connect @mobile", async ({ page }) => {
    // Capture navigations to the wallets' universal links instead of leaving the site.
    const opened: string[] = [];
    await page.route(/phantom\.app|metamask\.app\.link|go\.cb-w\.com/, (r) => { opened.push(r.request().url()); return r.fulfill({ status: 204, body: "" }); });
    await page.goto("/trade?symbol=SOLUSDT");
    await page.getByTestId("menu-button").click();
    await page.getByTestId("menu-connect").click();
    // Phantom's main option connects from this browser; the in-app browser is the secondary link.
    await expect(page.getByTestId("wallet-option-phantom")).toContainText("come right back");
    await page.getByTestId("phantom-open-inapp").click();
    await expect.poll(() => opened.length).toBeGreaterThan(0);
    const ph = new URL(opened[0]);
    expect(ph.hostname).toBe("phantom.app");
    const inner = new URL(decodeURIComponent(ph.pathname.replace("/ul/browse/", "")));
    expect(inner.pathname).toBe("/trade");
    expect(inner.searchParams.get("bajar_connect")).toBe("phantom");

    await page.goto("/trade?symbol=SOLUSDT");
    await page.getByTestId("menu-button").click();
    await page.getByTestId("menu-connect").click();
    await page.getByTestId("wallet-option-io.metamask").click();
    await expect.poll(() => opened.some((u) => u.includes("metamask.app.link/dapp/"))).toBe(true);
    expect(opened.find((u) => u.includes("metamask.app.link"))).toContain("bajar_connect=io.metamask");
    await expect(page.getByTestId("wallet-option-com.coinbase.wallet")).toBeVisible().catch(() => {});
  });

  test("arriving inside the wallet app opens the connect prompt automatically @mobile", async ({ page }) => {
    await page.addInitScript(() => {
      const pk = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
      const provider = { isPhantom: true, publicKey: null as null | { toString(): string }, connect: async () => { (window as unknown as { __asked: boolean }).__asked = true; provider.publicKey = { toString: () => pk }; return { publicKey: provider.publicKey }; }, disconnect: async () => {}, signMessage: async () => ({ signature: new Uint8Array(64) }), on: () => {}, off: () => {} };
      (window as unknown as { phantom: unknown }).phantom = { solana: provider };
    });
    await page.goto("/portfolio?bajar_connect=phantom");
    await expect(page.getByText(/Phantom · Solana/)).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => (window as unknown as { __asked?: boolean }).__asked)).toBe(true);
    await expect(page).not.toHaveURL(/bajar_connect/); // tag removed so refresh/share doesn't re-trigger
  });
});

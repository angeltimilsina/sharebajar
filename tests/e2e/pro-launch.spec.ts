import { expect, test, type Page } from "@playwright/test";
import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Pro profile (wallets proven by real ed25519 signatures), the Pro page, the
 * EVM launchpad and after-launch token controls.
 */
const A = nacl.sign.keyPair();
const B = nacl.sign.keyPair();
const addr = (k: nacl.SignKeyPair) => bs58.encode(k.publicKey);

/** Phantom stand-in whose account can be switched; messages are really signed in Node. */
async function stubPhantom(page: Page) {
  const keys: Record<string, Uint8Array> = { [addr(A)]: A.secretKey, [addr(B)]: B.secretKey };
  await page.exposeFunction("__nodeSign", (pk: string, msg: number[]) => Array.from(nacl.sign.detached(new Uint8Array(msg), keys[pk])));
  await page.addInitScript((pk) => {
    const w = window as unknown as { __pk: string; __nodeSign: (pk: string, m: number[]) => Promise<number[]>; phantom: unknown };
    w.__pk = pk;
    const provider = {
      isPhantom: true,
      publicKey: null as null | { toString(): string },
      connect: async () => { const k = w.__pk; provider.publicKey = { toString: () => k }; return { publicKey: provider.publicKey }; },
      disconnect: async () => { provider.publicKey = null; },
      signMessage: async (m: Uint8Array) => ({ signature: new Uint8Array(await w.__nodeSign(w.__pk, Array.from(m))) }),
      on: () => {}, off: () => {},
    };
    w.phantom = { solana: provider };
  }, addr(A));
}

async function connectPhantom(page: Page) {
  await expect(async () => {
    await page.getByTestId("menu-connect").first().click({ timeout: 2000 });
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
}

test.describe("Bajar Pro", () => {
  test.setTimeout(120_000);

  test("pricing page: Free vs Pro, checkout only to a verified treasury", async ({ page }) => {
    await page.goto("/pro");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("investment agent");
    await expect(page.getByText("Connect other wallets with a connection token")).toBeVisible();
    await expect(page.getByTestId("pro-checkout")).toContainText("USDC");
    // No active treasury in tests: checkout stays closed rather than paying anywhere else.
    await expect(page.getByTestId("pro-checkout")).toContainText("Checkout opens soon");
    await expect(page.getByTestId("pro-pay")).toBeDisabled();
  });

  test("connection token: Bajar Wallet creates it, another wallet signs and joins", async ({ page, context }) => {
    // Bajar Wallet: import the public test phrase, hybrid sign-in.
    await page.goto("/wallet");
    await page.getByRole("tab", { name: "Import", exact: true }).click();
    await page.getByTestId("bajar-import-phrase").fill("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    await page.getByTestId("bajar-ack-public").check();
    await page.getByTestId("bajar-import-next").click();
    await page.getByTestId("bajar-accounts-next").click();
    await page.getByTestId("bajar-password").fill("orbit-lantern-quiet-maple-29");
    await page.getByTestId("bajar-password2").fill("orbit-lantern-quiet-maple-29");
    await page.getByTestId("bajar-pw-ack").check();
    await page.getByTestId("bajar-pw-next").click();
    await expect(page.getByTestId("bajar-done")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("bajar-signup-name").fill("Test Student");
    await page.getByTestId("bajar-done-signin").click();
    await page.getByTestId("bajar-approve").click();
    await expect(page.getByTestId("bajar-signin-ok")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("bajar-open").click();

    const card = page.getByTestId("connected-wallets");
    await card.getByTestId("create-connect-token").click();
    const link = await card.getByTestId("connect-link").inputValue();
    expect(link).toMatch(/\/connect\/[1-9A-HJ-NP-Za-km-z]{20,40}$/);

    // The other wallet opens the link (no Bajar session needed there) and signs.
    const other = await context.browser()!.newContext();
    const p2 = await other.newPage();
    await stubPhantom(p2);
    await p2.goto(link);
    await expect(p2.getByTestId("connect-page")).toContainText("Joining Bajar Wallet");
    await p2.getByTestId("connect-page").getByRole("button", { name: /Connect$/ }).click();
    await p2.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
    await p2.getByTestId("connect-sign").click();
    await expect(p2.getByTestId("connect-done")).toBeVisible({ timeout: 20_000 });

    // Bajar Wallet sees it join; the token can't be used again.
    const short = `${addr(A).slice(0, 4)}…${addr(A).slice(-4)}`; // the stand-in Phantom starts on account A
    const row = card.getByTestId("connected-list").locator("li").filter({ hasText: short });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await p2.goto(link);
    await expect(p2.getByTestId("connect-page")).toContainText("Token expired or used");
    await other.close();

    // Portfolio is the one Bajar Wallet, now including the connected wallet (client-side nav keeps it unlocked).
    await page.getByTestId("wallet-sidebar").getByRole("link", { name: "Portfolio" }).click();
    await expect(page.getByTestId("portfolio-source")).toHaveText("Bajar Wallet");
    await expect(page.getByTestId("dashboard-wallet-count")).toContainText(/\d+ connected wallets?/);
    // Clean up: disconnect it again from Bajar Wallet.
    const del = await page.request.delete(`/api/profile/wallets?address=${addr(A)}`, { headers: { origin: new URL(page.url()).origin } });
    expect(del.ok()).toBe(true);
  });

  test("Pro activation rejects unknown payments", async ({ page }) => {
    const r = await page.request.post("/api/pro/activate", { data: { signature: "1".repeat(88) }, headers: { origin: "http://localhost:3100" } });
    expect([401, 503]).toContain(r.status());
  });
});

test.describe("Launchpad", () => {
  test.setTimeout(120_000);

  test("EVM launch on Base: simulated, one deploy transaction of the BajarToken contract", async ({ page }) => {
    await page.addInitScript(() => {
      const calls: { method: string; params?: unknown[] }[] = [];
      (window as unknown as { __evmCalls: typeof calls }).__evmCalls = calls;
      let chainId = "0x1";
      const provider = {
        isMetaMask: true,
        async request({ method, params }: { method: string; params?: unknown[] }) {
          calls.push({ method, params });
          switch (method) {
            case "eth_requestAccounts": case "eth_accounts": return ["0x1111111111111111111111111111111111111111"];
            case "eth_chainId": return chainId;
            case "wallet_switchEthereumChain": chainId = (params![0] as { chainId: string }).chainId; return null;
            case "eth_call": return "0x";
            case "eth_estimateGas": return "0x89520";
            case "eth_gasPrice": return "0x3b9aca00";
            case "eth_getBalance": return "0xde0b6b3a7640000"; // 1 ETH
            case "eth_sendTransaction": return "0x" + "cd".repeat(32);
            case "eth_getTransactionReceipt": return { status: "0x1", contractAddress: "0x2222222222222222222222222222222222222222" };
            default: return null;
          }
        },
        on() {}, removeListener() {},
      };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "t", name: "MetaMask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "io.metamask" }, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    });
    await page.goto("/launchpad");
    const w = page.getByTestId("launch-wizard");
    await w.getByLabel("Token name", { exact: true }).fill("Test Token");
    await w.getByLabel("Symbol", { exact: true }).fill("TEST");
    await w.getByTestId("wizard-next").click();
    // Fee grows with networks: compare 1 vs 3 networks in the plan's pricing line.
    await expect(w.getByTestId("fee-plan")).toContainText("1 network 10 USDC · 2 networks 25 USDC · 3 networks 45 USDC · 4 networks 70 USDC");
    await w.getByTestId("net-solana").click(); // deselect
    await w.getByTestId("net-base").click();
    await expect(w.getByTestId("fee-plan")).toContainText("1 network");
    await w.getByTestId("wizard-start").click();
    const l = w.getByTestId("launch-row-base").getByTestId("evm-launcher");
    await l.getByTestId("launch-connect").click();
    await page.getByRole("dialog").getByRole("button", { name: /MetaMask/ }).click();
    await l.getByRole("button", { name: /Review launch on Base/ }).click();
    await expect(l.getByText("Simulation passed")).toBeVisible({ timeout: 20_000 });
    await l.getByRole("button", { name: /Launch TEST/ }).click();
    await expect(w.getByTestId("launch-row-base")).toContainText("Live", { timeout: 30_000 });
    await expect(w.getByTestId("wizard-summary")).toContainText("TEST is live on 1 of 1 network");
    await expect(w.getByTestId("open-manager")).toBeVisible();
    const calls = await page.evaluate(() => (window as unknown as { __evmCalls: { method: string; params?: { data?: string; to?: string }[] }[] }).__evmCalls);
    expect(calls.some((c) => c.method === "wallet_switchEthereumChain" && (c.params?.[0] as unknown as { chainId: string }).chainId === "0x2105")).toBe(true);
    const sends = calls.filter((c) => c.method === "eth_sendTransaction");
    expect(sends).toHaveLength(1);
    expect(sends[0].params?.[0].to).toBeUndefined(); // contract creation
    expect(sends[0].params?.[0].data?.startsWith("0x6080")).toBe(true);
    // The manager's liquidity tab offers Base DEXs (not PancakeSwap).
    await w.getByTestId("open-manager").click();
    await expect(page).toHaveURL(/\/launchpad\/token\/base\/0x2222222222222222222222222222222222222222/);
    await page.getByTestId("token-manager").getByRole("tab", { name: "Liquidity" }).click();
    await expect(page.getByTestId("create-pool").getByRole("link", { name: /Uniswap/ })).toBeVisible();
    await expect(page.getByTestId("create-pool").getByRole("link", { name: /PancakeSwap/ })).toHaveCount(0);
  });

  test("manage token: reads a Solana mint's authorities and metadata on-chain", async ({ page }) => {
    await stubPhantom(page);
    await page.goto("/launchpad");
    await connectPhantom(page);
    const m = page.getByTestId("manage-tokens");
    await expect(m).toBeVisible();
    await m.getByLabel("Token address").fill("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"); // BONK
    await m.getByRole("button", { name: /Open/ }).click();
    // The token manager page: overview with holders, liquidity with real pools, then controls.
    const tm = page.getByTestId("token-manager");
    await expect(tm).toBeVisible({ timeout: 20_000 });
    await expect(tm.getByTestId("holders")).toBeVisible();
    await tm.getByRole("tab", { name: "Liquidity" }).click();
    await expect(tm.getByTestId("liquidity").locator("table")).toBeVisible({ timeout: 30_000 });
    await expect(tm.getByTestId("create-pool")).toBeVisible();
    await tm.getByRole("tab", { name: "Profile" }).click();
    await expect(tm.getByTestId("profile-save")).toBeDisabled(); // not launched by this wallet
    await tm.getByRole("tab", { name: "Supply & control" }).click();
    const s = tm.getByTestId("manage-solana");
    await expect(s.getByText("Mint authority")).toBeVisible({ timeout: 30_000 });
    await expect(s.getByText("Revoked").first()).toBeVisible();
    await expect(s.getByText("Editable by another wallet")).toBeVisible();
    await expect(s.getByTestId("ctl-revoke-mint")).toHaveCount(0); // not our authority
    await expect(s.getByRole("link", { name: /Raydium/ })).toBeVisible();
  });
});

test.describe("Admin with Bajar Wallet", () => {
  test.setTimeout(150_000);
  test("treasury admin: unlock Bajar Wallet in place and sign in with it (not an owner → told which address to authorize)", async ({ page }) => {
    await page.goto("/wallet");
    await page.getByRole("tab", { name: "Import", exact: true }).click();
    await page.getByTestId("bajar-import-phrase").fill("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    await page.getByTestId("bajar-ack-public").check();
    await page.getByTestId("bajar-import-next").click();
    await page.getByTestId("bajar-accounts-next").click();
    await page.getByTestId("bajar-password").fill("orbit-lantern-quiet-maple-29");
    await page.getByTestId("bajar-password2").fill("orbit-lantern-quiet-maple-29");
    await page.getByTestId("bajar-pw-ack").check();
    await page.getByTestId("bajar-pw-next").click();
    await expect(page.getByTestId("bajar-done")).toBeVisible({ timeout: 60_000 });

    await page.goto("/admin/treasury"); // full load: Bajar Wallet is locked again
    const box = page.getByTestId("admin-bajar");
    await box.getByTestId("bajar-password").fill("orbit-lantern-quiet-maple-29");
    await box.getByTestId("bajar-unlock").click();
    await expect(box.getByTestId("bajar-admin-address")).toHaveText("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk", { timeout: 60_000 });
    await box.getByTestId("bajar-admin-signin").click();
    await page.getByTestId("bajar-approve").click();
    await expect(box.getByText("Signed in, but not a treasury admin")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Learn", () => {
  test.setTimeout(150_000);
  test("lessons with quizzes and a devnet student sandbox", async ({ page }) => {
    await page.goto("/learn");
    await expect(page.getByTestId("learn-progress")).toHaveText("0 / 6 lessons");
    const lesson = page.getByTestId("lesson-wallets");
    await lesson.getByRole("button", { name: "Refuse — nobody legitimate ever needs it" }).click();
    await expect(page.getByTestId("learn-progress")).toHaveText("1 / 6 lessons");
    const sb = page.getByTestId("sandbox");
    await expect(sb.getByTestId("sandbox-address")).toHaveText(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    await expect(sb.getByTestId("sandbox-balance")).toBeVisible(); // devnet may be unreachable from CI
    await expect(sb.getByTestId("sandbox-launch")).toBeDisabled(); // needs test SOL first
    // The relay serves devnet only through its own chain id and limits airdrops.
    const r = await page.evaluate(() => fetch("/api/wallet/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "solana-devnet", method: "requestAirdrop", params: ["11111111111111111111111111111111", 5e9] }) }).then((x) => x.status));
    expect(r).toBe(400); // more than 1 SOL refused
  });
});

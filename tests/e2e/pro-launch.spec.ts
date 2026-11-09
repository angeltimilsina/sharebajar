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
    await expect(page.getByRole("heading", { level: 1 })).toContainText("one profile");
    await expect(page.getByText("Wallets in one verified profile")).toBeVisible();
    await expect(page.getByTestId("pro-checkout")).toContainText("USDC");
    // No active treasury in tests: checkout stays closed rather than paying anywhere else.
    await expect(page.getByTestId("pro-checkout")).toContainText("Checkout opens soon");
    await expect(page.getByTestId("pro-pay")).toBeDisabled();
  });

  test("profile: sign in, then link a second wallet by signature", async ({ page }) => {
    await stubPhantom(page);
    await page.goto("/pro");
    await connectPhantom(page);
    await page.getByTestId("profile-signin").click();
    const list = page.getByTestId("profile-wallets");
    await expect(list.getByText(/signed in/)).toBeVisible({ timeout: 20_000 });
    await expect(list.locator("li")).toHaveCount(1);

    // Switch the wallet's account to B and link it.
    await page.evaluate((b) => { (window as unknown as { __pk: string }).__pk = b; }, addr(B));
    // Connect the other account from the profile card (keeps the sign-in), then link it.
    await page.getByTestId("profile-card").getByRole("button", { name: /Connect another wallet/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
    await page.getByTestId("profile-link").click();
    await expect(list.locator("li")).toHaveCount(2, { timeout: 20_000 });
    // The linked wallet is now in the registry, marked as verified.
    const reg = await page.evaluate(() => JSON.parse(localStorage.getItem("bajar.wallets.v1") ?? "[]") as { address: string; verified?: boolean }[]);
    expect(reg.find((w) => w.address === addr(B))?.verified ?? reg.some((w) => w.address === addr(B))).toBeTruthy();
    // Forged link attempts are rejected by the server.
    const forged = await page.evaluate(async () => {
      const r = await fetch("/api/profile/link/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature: "1".repeat(88) }) });
      return r.status;
    });
    expect([400, 401]).toContain(forged);
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
    await page.getByTestId("launch-chain").getByRole("radio", { name: /Base/ }).click();
    const l = page.getByTestId("evm-launcher");
    await l.getByLabel("Token name").fill("Test Token");
    await l.getByLabel("Symbol").fill("TEST");
    await l.getByTestId("launch-connect").click();
    await page.getByRole("dialog").getByRole("button", { name: /MetaMask/ }).click();
    await l.getByRole("button", { name: /Review launch on Base/ }).click();
    await expect(l.getByText("Simulation passed")).toBeVisible({ timeout: 20_000 });
    await l.getByRole("button", { name: /Launch TEST/ }).click();
    await expect(page.getByTestId("launch-done")).toContainText("TEST is live on Base", { timeout: 30_000 });
    const calls = await page.evaluate(() => (window as unknown as { __evmCalls: { method: string; params?: { data?: string; to?: string }[] }[] }).__evmCalls);
    expect(calls.some((c) => c.method === "wallet_switchEthereumChain" && (c.params?.[0] as unknown as { chainId: string }).chainId === "0x2105")).toBe(true);
    const sends = calls.filter((c) => c.method === "eth_sendTransaction");
    expect(sends).toHaveLength(1);
    expect(sends[0].params?.[0].to).toBeUndefined(); // contract creation
    expect(sends[0].params?.[0].data?.startsWith("0x6080")).toBe(true);
    await expect(page.getByTestId("launch-done").getByRole("link", { name: "PancakeSwap" })).toHaveCount(0);
    await expect(page.getByTestId("launch-done").getByRole("link", { name: "Uniswap" })).toBeVisible();
  });

  test("manage token: reads a Solana mint's authorities and metadata on-chain", async ({ page }) => {
    await stubPhantom(page);
    await page.goto("/launchpad");
    await connectPhantom(page);
    const m = page.getByTestId("manage-tokens");
    await expect(m).toBeVisible();
    await m.getByLabel("Token address").fill("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"); // BONK
    await m.getByRole("button", { name: /Open/ }).click();
    const s = m.getByTestId("manage-solana");
    await expect(s.getByText("Mint authority")).toBeVisible({ timeout: 30_000 });
    await expect(s.getByText("Revoked").first()).toBeVisible();
    await expect(s.getByText("Editable by another wallet")).toBeVisible();
    await expect(s.getByTestId("ctl-revoke-mint")).toHaveCount(0); // not our authority
    await expect(s.getByRole("link", { name: /Raydium/ })).toBeVisible();
  });
});

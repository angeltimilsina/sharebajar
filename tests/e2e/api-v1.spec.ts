import { expect, test } from "@playwright/test";

/**
 * Public market-data API v1. Live endpoints hit real providers; when a free
 * provider rate-limits this machine they must answer 503 with an explicit
 * error (never an empty or made-up success), so tests accept either.
 */
test.describe("market-data API v1", () => {
  test("chains, OpenAPI spec, CORS and validation", async ({ request }) => {
    const chains = await request.get("/api/v1/chains");
    expect(chains.ok()).toBe(true);
    expect(chains.headers()["access-control-allow-origin"]).toBe("*");
    const body = await chains.json();
    expect(body.data.filter((c: { phase: number }) => c.phase === 1).map((c: { id: string }) => c.id)).toEqual(["solana", "base"]);
    expect(body.meta.fetchedAt).toBeTruthy();

    const spec = await (await request.get("/api/v1/openapi.json")).json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toContain("/api/v1/tokens/{chain}/{address}");

    const bad = await request.get("/api/v1/tokens/solana/not-an-address");
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_address");
    expect((await request.get("/api/v1/tokens/dogechain/abc")).status()).toBe(404);
    expect((await (await request.get("/api/v1/tokens/trending?chain=solana&window=7d")).json()).error.code).toBe("invalid_param");
    expect((await request.get("/api/v1/search?q=a")).status()).toBe(400);
    expect((await request.get("/api/v1/stream/pools/base/not-a-pool")).status()).toBe(400);
  });

  test("live trending pools come back normalized (or an explicit unavailable)", async ({ request }) => {
    const r = await request.get("/api/v1/tokens/trending?chain=solana&window=24h");
    if (r.status() === 503) { expect((await r.json()).error.code).toBe("upstream_unavailable"); return; }
    expect(r.ok()).toBe(true);
    const { data, meta } = await r.json();
    expect(data.length).toBeGreaterThan(0);
    expect(meta.source).toContain("GeckoTerminal");
    for (const p of data) { expect(p.chain).toBe("solana"); expect(p.address).toBeTruthy(); expect(p.base.symbol).toBeTruthy(); }
  });

  test("history says the indexer isn't connected instead of returning nothing", async ({ request }) => {
    const r = await request.get("/api/v1/pools/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263/history");
    if (r.ok()) { expect(Array.isArray((await r.json()).data)).toBe(true); return; } // indexer present
    expect(r.status()).toBe(503);
    expect((await r.json()).error).toMatchObject({ code: "indexer_unavailable" });
  });

  test("developers page lists every endpoint and links the spec", async ({ page }) => {
    await page.goto("/developers");
    await expect(page.getByRole("heading", { name: "BAJAR market-data API" })).toBeVisible();
    await expect(page.getByTestId("endpoints")).toContainText("/api/v1/tokens/{chain}/{address}/risk");
    await expect(page.getByTestId("openapi-link")).toHaveAttribute("href", "/api/v1/openapi.json");
  });

  test("home command: token search via the API, and handing a request to Agents", async ({ page }) => {
    await page.route("**/api/v1/search?*", (route) => route.fulfill({ json: { data: [{ chain: "solana", address: "P1", dex: "Orca", name: "BONK / SOL", base: { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "Bonk", name: "Bonk", image: null }, priceUsd: 0.00002, liquidityUsd: 10_000_000, priceChangePct: { h24: 3.2 } }], meta: { source: "DexScreener", fetchedAt: new Date().toISOString(), stale: false } } }));
    await page.goto("/");
    const cmd = page.getByTestId("home-command");
    await cmd.getByTestId("home-command-input").fill("bonk");
    await expect(cmd.getByTestId("home-search-results")).toContainText("Bonk");
    await expect(cmd.getByRole("link", { name: /Bonk/ })).toHaveAttribute("href", "/token/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    await cmd.getByTestId("mode-agents").click();
    await cmd.getByTestId("home-command-input").fill("#Find TEST headphones");
    await cmd.getByTestId("home-command-input").press("Enter");
    await expect(page).toHaveURL(/\/agents\?q=/);
    await expect(page.getByTestId("agent-workspace")).toBeVisible({ timeout: 20_000 });
  });
});

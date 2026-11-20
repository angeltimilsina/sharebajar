import type { Page } from "@playwright/test";

/**
 * TEST-ONLY: stands in for the sign-in endpoints in the browser, for tests
 * whose stand-in wallets use real funded public addresses (read-only quotes
 * and balances) and therefore can't produce valid signatures. Only this
 * browser page sees it; the server's gateway is untouched, so any API that
 * needs a real session still refuses. Tests of the gateway itself use real
 * ed25519 signatures instead (session.spec.ts, agents.spec.ts).
 */
export async function fakeAuth(page: Page) {
  let pending: { address: string; chainType: string } | null = null;
  let session: { address: string; chainType: string; exp: number; iat: number } | null = null;
  await page.route("**/api/auth/nonce*", (route) => {
    const u = new URL(route.request().url());
    pending = { address: u.searchParams.get("address") ?? "", chainType: u.searchParams.get("chainType") ?? "solana" };
    return route.fulfill({ json: { message: `localhost wants you to sign in with your wallet:\n${pending.address}\n(test)` } });
  });
  await page.route("**/api/auth/verify", (route) => {
    session = pending ? { ...pending, exp: Date.now() + 3600_000, iat: Date.now() } : null;
    return route.fulfill({ json: session ? { ok: true, session } : { error: "no challenge" }, status: session ? 200 : 400 });
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { session } }));
  await page.route("**/api/auth/logout*", (route) => { session = null; return route.fulfill({ json: { ok: true } }); });
}

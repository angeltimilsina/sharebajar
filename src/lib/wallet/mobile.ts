"use client";

/**
 * Phones have no wallet browser extensions, so "Connect Phantom" in Safari or
 * Chrome has nothing to talk to. The standard pattern is a universal link that
 * opens this page inside the wallet app's own browser, where the wallet is
 * injected. We append `bajar_connect=<wallet>` so the connection prompt opens
 * as soon as the page loads there (the user still approves it in the wallet).
 */
export const CONNECT_PARAM = "bajar_connect";

export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS reports a Mac UA; detect it by touch support.
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** The current page, tagged so the wallet browser auto-opens the connect prompt. */
function target(walletId: string): string {
  const u = new URL(window.location.href);
  u.searchParams.set(CONNECT_PARAM, walletId);
  u.hash = "";
  return u.toString();
}

/** Official universal links that open a URL inside each wallet app's browser. */
const LINKS: Record<string, (url: string, origin: string) => string> = {
  phantom: (url, origin) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`,
  solflare: (url, origin) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`,
  backpack: (url, origin) => `https://backpack.app/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`,
  "io.metamask": (url) => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}`,
  "com.coinbase.wallet": (url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
  "com.trustwallet.app": (url) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}`,
};

export const hasDeepLink = (walletId: string) => walletId in LINKS;

export function walletDeepLink(walletId: string): string | null {
  const f = LINKS[walletId];
  return f ? f(target(walletId), window.location.origin) : null;
}

/** Wallets that are only reachable on phones through their app (no extension to detect). */
export const MOBILE_ONLY_EVM = [
  { id: "com.coinbase.wallet", name: "Coinbase Wallet" },
  { id: "com.trustwallet.app", name: "Trust Wallet" },
];

/** Read and strip the auto-connect tag from the URL (so refresh/share doesn't re-trigger it). */
export function takeConnectRequest(): string | null {
  if (typeof window === "undefined") return null;
  const u = new URL(window.location.href);
  const id = u.searchParams.get(CONNECT_PARAM);
  if (!id) return null;
  u.searchParams.delete(CONNECT_PARAM);
  window.history.replaceState(window.history.state, "", u.pathname + (u.search ? u.search : "") + u.hash);
  return hasDeepLink(id) ? id : null;
}

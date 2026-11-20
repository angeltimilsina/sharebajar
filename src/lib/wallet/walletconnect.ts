"use client";
import type { Eip1193 } from "./evm";

/**
 * WalletConnect v2 for EVM wallets on phones (MetaMask, Coinbase Wallet,
 * Trust, Rainbow…): the browser pairs with the wallet app over WalletConnect's
 * end-to-end encrypted relay, the app approves, and replies come back to this
 * page — the user stays in their own browser. Requires a (free) project id:
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. Without it, phones fall back to
 * opening Bajar inside the wallet's in-app browser.
 */
const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
export const wcAvailable = () => PROJECT_ID.length >= 16;

/** Universal links that open each app with a WalletConnect pairing URI (or just the app). */
const APP_LINK: Record<string, string> = {
  "io.metamask": "https://metamask.app.link",
  "com.coinbase.wallet": "https://go.cb-w.com",
  "com.trustwallet.app": "https://link.trustwallet.com",
  "me.rainbow": "https://rnbwapp.com",
};
export const WC_WALLETS = Object.keys(APP_LINK);
export const wcId = (wallet: string) => `wc:${wallet}`;
export const wcWalletOf = (id: string | null | undefined) => (id?.startsWith("wc:") ? id.slice(3) : null);

type WcProvider = Eip1193 & { connect: () => Promise<void>; disconnect: () => Promise<void>; accounts: string[]; session?: unknown; on: (e: string, f: (...a: unknown[]) => void) => void };
let provider: WcProvider | null = null;
let initializing: Promise<WcProvider> | null = null;
let activeWallet: string | null = null;

const SIGNING = new Set(["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "wallet_switchEthereumChain", "wallet_addEthereumChain"]);

async function init(): Promise<WcProvider> {
  if (provider) return provider;
  initializing ??= (async () => {
    const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
    const p = (await EthereumProvider.init({
      projectId: PROJECT_ID,
      chains: [1],
      optionalChains: [8453, 42161, 10, 137, 56, 43114],
      showQrModal: false,
      metadata: { name: "Bajar", description: "Multi-chain crypto marketplace", url: window.location.origin, icons: [`${window.location.origin}/icon.svg`] },
    })) as unknown as WcProvider;
    // Signature requests are delivered by the relay; bring the wallet app to the front so the user sees them.
    const request = p.request.bind(p);
    p.request = (async (args: { method: string; params?: unknown[] }) => {
      if (SIGNING.has(args.method) && activeWallet && APP_LINK[activeWallet]) setTimeout(() => { window.location.href = APP_LINK[activeWallet!]; }, 50);
      return request(args);
    }) as Eip1193["request"];
    provider = p;
    return p;
  })();
  return initializing;
}

/** Pair with a wallet app; resolves with the connected provider. */
export async function wcConnect(wallet: string): Promise<WcProvider> {
  if (!wcAvailable()) throw new Error("WalletConnect isn't configured on this site.");
  const p = await init();
  activeWallet = wallet;
  const onUri = (...a: unknown[]) => {
    const uri = String(a[0]);
    window.location.href = APP_LINK[wallet] ? `${APP_LINK[wallet]}/wc?uri=${encodeURIComponent(uri)}` : uri;
  };
  p.on("display_uri", onUri);
  if (!p.session) await p.connect();
  return p;
}

/** Restore a previous WalletConnect session after a reload (no prompts). */
export async function wcRestore(wallet: string): Promise<WcProvider | null> {
  if (!wcAvailable()) return null;
  const p = await init();
  activeWallet = wallet;
  return p.session && p.accounts?.length ? p : null;
}

export const wcProvider = (): Eip1193 | undefined => provider ?? undefined;

export async function wcDisconnect() {
  try { await provider?.disconnect(); } catch { /* already gone */ }
  activeWallet = null;
}

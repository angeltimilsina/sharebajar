"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getSolanaProvider, solanaSignMessage, SOLANA_WALLETS, type InjectedSolana } from "@/lib/wallet/solana";
import { evmDiscovery, evmSignMessage, getEvmProvider, startEvmDiscovery, type Eip1193 } from "@/lib/wallet/evm";
import type { ConnectedWallet } from "@/lib/wallet/types";
import { takeConnectRequest } from "@/lib/wallet/mobile";
import { wcConnect, wcDisconnect, wcRestore, wcWalletOf } from "@/lib/wallet/walletconnect";
import { toast } from "@/components/layout/Toaster";
import { clearLinkSession, LINK_WALLETS, linkId, linkSession, linkSignMessage, linkWalletOf, readLinkReturn } from "@/lib/wallet/solanaLink";
import type { ChainType } from "@/lib/types";

interface Session { address: string; chainType: ChainType; exp: number }

interface WalletContextValue {
  wallet: ConnectedWallet | null;
  session: Session | null;
  connecting: string | null;
  error: string | null;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  connect: (walletId: string, chainType: ChainType, name: string) => Promise<void>;
  disconnect: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Ask the connected wallet to sign a plain-text message (no transaction). */
  signMessage: (message: string) => Promise<string>;
  solana: () => InjectedSolana | undefined;
  evm: () => Eip1193 | undefined;
  clearError: () => void;
  /** True while a remembered wallet is shown from cache and is being re-checked with the wallet. */
  restoring: boolean;
  /** One authentication layer: true when a verified wallet-signature session matches the connected wallet (or no wallet is connected but the session is valid). */
  authenticated: boolean;
  /** A wallet is connected but its signature hasn't been verified for this session (e.g. account switched or session expired). */
  needsAuth: boolean;
  /** The session check with the server has completed at least once. */
  sessionLoaded: boolean;
  /** Verify the connected wallet (sign the challenge). Resolves true when the session is issued. */
  authenticate: () => Promise<boolean>;
  /** Re-check the remembered wallet: reconnect silently, pick up account/network changes. */
  sync: () => Promise<void>;
  syncing: boolean;
}

const Ctx = createContext<WalletContextValue | null>(null);
const LAST = "sb.wallet.last";
const EMPTY: never[] = [];
const EMPTY_FN = () => EMPTY;

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside WalletProvider");
  return v;
}

export function useEvmWallets() {
  return useSyncExternalStore(evmDiscovery.subscribe, evmDiscovery.get, EMPTY_FN);
}

function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (/reject|denied|cancel/i.test(m)) return "Request was cancelled in your wallet.";
  return m || "Wallet error";
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  /** The shown wallet was confirmed by the wallet itself in this page load (not just restored from cache). */
  const verified = useRef(false);
  const walletRef = useRef<ConnectedWallet | null>(null);
  const signInRef = useRef<(w: ConnectedWallet | null) => Promise<boolean>>(async () => false);
  const sessionRef = useRef<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // Remember the connected wallet (public address only) so the next page load shows it immediately.
  useEffect(() => {
    if (!wallet || !verified.current) return;
    try { localStorage.setItem(LAST, JSON.stringify({ walletId: wallet.walletId, chainType: wallet.chainType, name: wallet.walletName, address: wallet.address, chainId: wallet.chainId, ok: true })); } catch { /* ignore */ }
  }, [wallet]);

  const solana = useCallback(() => {
    const lw = linkWalletOf(wallet?.walletId);
    if (wallet && lw) {
      // Deep-link sessions sign by redirecting to the wallet app; flows that support it branch before calling this.
      const unsupported = async () => { throw new Error(`This action needs ${LINK_WALLETS[lw].name}'s in-app browser. Open Bajar from the ${LINK_WALLETS[lw].name} app to continue.`); };
      return { publicKey: { toString: () => wallet.address }, connect: unsupported, disconnect: async () => {}, signMessage: unsupported, signTransaction: unsupported } as unknown as InjectedSolana;
    }
    return wallet?.chainType === "solana" ? getSolanaProvider(wallet.walletId) : undefined;
  }, [wallet]);
  const evm = useCallback(() => (wallet?.chainType === "evm" ? getEvmProvider(wallet.walletId) : undefined), [wallet]);

  const attachListeners = useCallback((id: string, chainType: ChainType, name: string) => {
    cleanup.current?.();
    if (chainType === "solana") {
      const p = getSolanaProvider(id);
      if (!p?.on) return;
      const onAcc = (pk?: unknown) => {
        if (pk && typeof (pk as { toString?: () => string }).toString === "function") setWallet({ walletId: id, walletName: name, chainType, address: String(pk) });
        else setWallet(null);
      };
      const onDisc = () => setWallet(null);
      p.on("accountChanged", onAcc);
      p.on("disconnect", onDisc);
      cleanup.current = () => { (p.off ?? p.removeListener)?.call(p, "accountChanged", onAcc); (p.off ?? p.removeListener)?.call(p, "disconnect", onDisc); };
    } else {
      const p = getEvmProvider(id);
      if (!p?.on) return;
      const onAcc = (...a: unknown[]) => {
        const accs = a[0] as string[];
        setWallet((w) => (accs?.[0] ? { ...(w ?? { walletId: id, walletName: name, chainType }), address: accs[0] } : null));
      };
      const onChain = (...a: unknown[]) => setWallet((w) => (w ? { ...w, chainId: Number(a[0] as string) } : w));
      p.on("accountsChanged", onAcc);
      p.on("chainChanged", onChain);
      cleanup.current = () => { p.removeListener?.("accountsChanged", onAcc); p.removeListener?.("chainChanged", onChain); };
    }
  }, []);

  const connect = useCallback(async (walletId: string, chainType: ChainType, name: string, silent = false): Promise<boolean> => {
    setError(null);
    // Silent reconnects (focus, visibility) don't show a "connecting" state: no flicker.
    if (!silent) setConnecting(walletId);
    try {
      if (chainType === "solana") {
        const p = getSolanaProvider(walletId);
        if (!p) throw new Error(`${name} is not installed`);
        const res = await p.connect(silent ? { onlyIfTrusted: true } : undefined);
        const pk = (res && "publicKey" in res ? res.publicKey : p.publicKey)?.toString();
        if (!pk) throw new Error("No account returned");
        verified.current = true;
        walletRef.current = { walletId, walletName: name, chainType, address: pk };
        setWallet(walletRef.current);
      } else {
        const wcw = wcWalletOf(walletId);
        // WalletConnect: pair with the wallet app (silent = restore an existing session only).
        if (wcw) { const restored = silent ? await wcRestore(wcw) : await wcConnect(wcw); if (!restored) return false; }
        const p = getEvmProvider(walletId);
        if (!p) throw new Error(`${name} is not installed`);
        const accounts = (await p.request({ method: silent ? "eth_accounts" : "eth_requestAccounts" })) as string[];
        if (!accounts?.[0]) throw new Error("No account returned");
        const chainId = Number((await p.request({ method: "eth_chainId" })) as string);
        verified.current = true;
        walletRef.current = { walletId, walletName: name, chainType, address: accounts[0], chainId };
        setWallet(walletRef.current);
      }
      try { localStorage.setItem(LAST, JSON.stringify({ walletId, chainType, name })); } catch { /* ignore */ }
      attachListeners(walletId, chainType, name);
      setModalOpen(false);
      if (!silent) {
        // One authentication gateway: connecting a wallet means proving it with a signature.
        const cw = walletRef.current ?? null;
        const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
        const addr = cw?.address;
        if (!same(sessionRef.current?.address, addr)) {
          const ok = await signInRef.current(cw);
          if (!ok) {
            try { await getSolanaProvider(walletId)?.disconnect(); } catch { /* ignore */ }
            cleanup.current?.();
            verified.current = false;
            setWallet(null);
            try { localStorage.removeItem(LAST); } catch { /* ignore */ }
            setError((e) => `${e ? `${e} ` : ""}Bajar needs one signature to verify your wallet (no transaction, no fees). Your wallet wasn't connected.`);
            setModalOpen(true);
            return false;
          }
        }
      }
      return true;
    } catch (e) {
      if (!silent) setError(friendlyError(e));
      return false;
    } finally {
      setConnecting(null);
    }
  }, [attachListeners]);

  // Back from a wallet app (Solana deep-link protocol): verify the encrypted reply and finish the action.
  useEffect(() => {
    const ret = readLinkReturn();
    if (!ret) return;
    if (!ret.ok) { setError(ret.error); toast(ret.error); if (ret.resume?.kind === "connect") setModalOpen(true); return; }
    const w = ret.wallet, wName = LINK_WALLETS[w].name, wId = linkId(w);
    const acct = linkSession(w);
    if (ret.resume.kind === "connect" && ret.publicKey) {
      verified.current = true;
      setWallet({ walletId: wId, walletName: wName, chainType: "solana", address: ret.publicKey });
      try { localStorage.setItem(LAST, JSON.stringify({ walletId: wId, chainType: "solana", name: wName })); } catch { /* ignore */ }
      toast(`${wName} connected — verify it to sign in`);
      return;
    }
    if (!acct) return;
    setWallet({ walletId: wId, walletName: wName, chainType: "solana", address: acct.publicKey });
    if (ret.resume.kind === "signin" && ret.signature) {
      fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature: ret.signature }) })
        .then((r) => r.json()).then((v) => { if (!v.ok) throw new Error(v.error ?? "Verification failed"); setSession(v.session); toast(`Signed in with ${wName}`); })
        .catch((e) => setError(friendlyError(e)));
      return;
    }
    if (ret.resume.kind === "swap" && ret.signedTxBase64) {
      const r = ret.resume;
      const signed = ret.signedTxBase64;
      (async () => {
        try {
          // Re-verify what Phantom signed before it goes anywhere.
          const { assertSafeSolanaSwap } = await import("@/lib/wallet/txguard");
          await assertSafeSolanaSwap(signed, acct.publicKey);
          let signature: string;
          if (r.route === "order") {
            const res = await fetch("/api/swap/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedTransaction: signed, requestId: r.requestId, intentToken: r.intentToken }) }).then((x) => x.json());
            if (!res.signature) throw new Error(res.error ?? `Execution failed (code ${res.code ?? "?"})`);
            signature = res.signature;
          } else {
            const { rpc } = await import("@/lib/wallet/rpc");
            signature = await rpc<string>("sendTransaction", [signed, { encoding: "base64", maxRetries: 3, preflightCommitment: "confirmed" }]);
            if (r.intentToken) fetch("/api/treasury/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intentToken: r.intentToken, txHash: signature }) }).catch(() => {});
          }
          const { addActivity } = await import("@/lib/activity");
          addActivity({ chain: "solana", hash: signature, kind: r.activityKind, summary: r.summary, wallet: acct.publicKey, assetHref: r.assetHref });
          toast("Swap submitted · tracking it in Portfolio");
        } catch (e) { setError(friendlyError(e)); toast(friendlyError(e)); }
      })();
    }
    if (ret.resume.kind === "send" && ret.signedTxBase64) {
      const r = ret.resume, signed = ret.signedTxBase64;
      (async () => {
        try {
          // Plain transfers: must be paid by this wallet and grant no one control of assets.
          const { inspectSolanaTx } = await import("@/lib/wallet/txguard");
          const i = await inspectSolanaTx(signed);
          if (i.feePayer !== acct.publicKey || i.risks.length) throw new Error("Blocked: the signed transfer doesn't match what was requested.");
          const { rpc } = await import("@/lib/wallet/rpc");
          const signature = await rpc<string>("sendTransaction", [signed, { encoding: "base64", maxRetries: 3, preflightCommitment: "confirmed" }]);
          const { addActivity } = await import("@/lib/activity");
          addActivity({ chain: "solana", hash: signature, kind: "send", summary: r.summary, wallet: acct.publicKey });
          toast("Transfer submitted · tracking it in Portfolio");
        } catch (e) { setError(friendlyError(e)); toast(friendlyError(e)); }
      })();
    }
  }, []);

  // Arrived from a mobile deep link (opened inside the wallet's app browser):
  // open that wallet's connect prompt once its provider has been injected.
  useEffect(() => {
    const id = takeConnectRequest();
    if (!id) return;
    const solana = ["phantom", "solflare", "backpack"].includes(id);
    const name = ({ phantom: "Phantom", solflare: "Solflare", backpack: "Backpack", "io.metamask": "MetaMask", "com.coinbase.wallet": "Coinbase Wallet", "com.trustwallet.app": "Trust Wallet" } as Record<string, string>)[id] ?? id;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const ready = solana ? getSolanaProvider(id) : getEvmProvider(id);
      if (ready) { clearInterval(t); connect(id, solana ? "solana" : "evm", name); }
      else if (tries > 20) { clearInterval(t); setError(`${name} wasn't detected. Open this page from the ${name} app's browser to connect.`); setModalOpen(true); }
    }, 200);
    return () => clearInterval(t);
  }, [connect]);

  // Keep the connection in sync with the wallet (no popups):
  //  - on load, wait for late-injected wallets instead of giving up after one try;
  //  - when the app regains focus / is restored, re-check accounts and network;
  //  - a remembered wallet that's no longer authorised is shown as disconnected.
  walletRef.current = wallet ?? (verified.current ? walletRef.current : null);
  const [syncing, setSyncing] = useState(false);
  const syncBusy = useRef(false);
  const sync = useCallback(async () => {
    if (syncBusy.current) return;
    let last: { walletId: string; chainType: ChainType; name: string } | null = null;
    try { last = JSON.parse(localStorage.getItem(LAST) ?? "null"); } catch { /* ignore */ }
    if (!last) { setRestoring(false); return; }
    syncBusy.current = true; setSyncing(true);
    let ok = false;
    try {
      const lw = linkWalletOf(last.walletId);
      if (lw) {
        const acct = linkSession(lw);
        ok = !!acct; verified.current = ok;
        setWallet(acct ? { walletId: linkId(lw), walletName: LINK_WALLETS[lw].name, chainType: "solana", address: acct.publicKey } : null);
        return;
      }
      if (wcWalletOf(last.walletId)) { ok = verified.current && !!walletRef.current ? true : await connect(last.walletId, last.chainType, last.name, true); return; }
      // Injected wallets can appear late (extensions, EIP-6963 announcements): wait up to ~3s.
      const find = () => (last!.chainType === "solana" ? getSolanaProvider(last!.walletId) : getEvmProvider(last!.walletId));
      for (let i = 0; i < 15 && !find(); i++) await new Promise((r) => setTimeout(r, 200));
      const found = find();
      if (!found) return;
      const cur = verified.current ? walletRef.current : null;
      if (!cur || cur.walletId !== last.walletId) { ok = await connect(last.walletId, last.chainType, last.name, true); return; }
      ok = true;
      if (last.chainType === "solana") {
        const pk = (found as InjectedSolana).publicKey?.toString();
        if (pk && pk !== cur.address) setWallet({ ...cur, address: pk });
        else if (!pk) ok = await connect(last.walletId, last.chainType, last.name, true);
      } else {
        const p = found as Eip1193;
        const accounts = (await p.request({ method: "eth_accounts" }).catch(() => null)) as string[] | null;
        if (accounts && !accounts[0]) { ok = false; verified.current = false; return; } // access revoked in the wallet
        const chainId = Number(await p.request({ method: "eth_chainId" }).catch(() => cur.chainId ?? 0));
        if ((accounts?.[0] && accounts[0].toLowerCase() !== cur.address.toLowerCase()) || chainId !== cur.chainId) setWallet({ ...cur, address: accounts?.[0] ?? cur.address, chainId });
      }
    } catch { ok = verified.current; /* stay as-is; the next sync tries again */ }
    finally {
      // A wallet restored from cache that the wallet no longer confirms is cleared (the sign-in session, if any, stays).
      if (!ok && !verified.current) {
        setWallet(null);
        try { localStorage.setItem(LAST, JSON.stringify({ ...last, ok: false })); } catch { /* ignore */ }
      }
      syncBusy.current = false; setSyncing(false); setRestoring(false);
    }
  }, [connect]);

  useEffect(() => {
    startEvmDiscovery();
    // The sign-in session lives in an httpOnly cookie: re-read it on return and after Bajar Wallet signs in/out,
    // so the UI never shows "signed out" while the session is still valid (or the reverse).
    const readSession = () => fetch("/api/auth/session", { cache: "no-store" }).then((r) => r.json()).then((b) => setSession((s) => {
      const n = b.session ?? null;
      return s && n && s.address === n.address && s.exp === n.exp ? s : n;
    })).catch(() => {}).finally(() => setSessionLoaded(true));
    readSession();
    // Show the remembered wallet immediately (no "Connect" flash between pages), then confirm it with the wallet.
    try {
      const last = JSON.parse(localStorage.getItem(LAST) ?? "null") as { walletId: string; chainType: ChainType; name: string; address?: string; chainId?: number; ok?: boolean } | null;
      if (last?.address && last.ok) { setRestoring(true); setWallet((w) => w ?? { walletId: last.walletId, walletName: last.name, chainType: last.chainType, address: last.address!, chainId: last.chainId }); }
    } catch { /* ignore */ }
    sync();
    let lastRun = Date.now();
    const again = () => { if (document.visibilityState === "visible" && Date.now() - lastRun > 1500) { lastRun = Date.now(); sync(); readSession(); } };
    window.addEventListener("bajar:session", readSession);
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) again(); };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    window.addEventListener("pageshow", onShow);
    return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("focus", again); window.removeEventListener("pageshow", onShow); window.removeEventListener("bajar:session", readSession); cleanup.current?.(); };
  }, [sync]);

  const disconnect = useCallback(async () => {
    const lw = linkWalletOf(wallet?.walletId);
    if (lw) clearLinkSession(lw);
    if (wcWalletOf(wallet?.walletId)) await wcDisconnect();
    try { await getSolanaProvider(wallet?.walletId ?? "")?.disconnect(); } catch { /* ignore */ }
    cleanup.current?.();
    verified.current = false;
    setWallet(null);
    try { localStorage.removeItem(LAST); } catch { /* ignore */ }
    if (session) { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); setSession(null); }
  }, [wallet, session]);

  /** The gateway's only sign-in path: the wallet signs a single-use, domain-bound challenge and the server verifies it. */
  const signInWith = useCallback(async (w: ConnectedWallet | null): Promise<boolean> => {
    if (!w) return false;
    setError(null);
    try {
      const n = await fetch(`/api/auth/nonce?chainType=${w.chainType}&address=${encodeURIComponent(w.address)}`).then((r) => r.json());
      if (!n.message) throw new Error(n.error ?? "Could not start sign-in");
      let signature: string;
      const lw = linkWalletOf(w.walletId);
      if (lw) { linkSignMessage(lw, n.message, { kind: "signin" }); return false; }
      if (w.chainType === "solana") {
        const p = getSolanaProvider(w.walletId);
        if (!p) throw new Error("Wallet unavailable");
        signature = await solanaSignMessage(p, n.message);
      } else {
        const p = getEvmProvider(w.walletId);
        if (!p) throw new Error("Wallet unavailable");
        signature = await evmSignMessage(p, w.address, n.message);
      }
      const v = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature }) }).then((r) => r.json());
      if (!v.ok) throw new Error(v.error ?? "Verification failed");
      setSession(v.session);
      return true;
    } catch (e) {
      setError(friendlyError(e));
      return false;
    }
  }, []);
  const signIn = useCallback(async () => { await signInWith(walletRef.current); }, [signInWith]);
  signInRef.current = signInWith;

  const signMessage = useCallback(async (message: string) => {
    if (!wallet) throw new Error("Connect a wallet first.");
    if (linkWalletOf(wallet.walletId)) throw new Error("Open Bajar in your wallet's in-app browser to sign this message.");
    if (wallet.chainType === "solana") {
      const p = getSolanaProvider(wallet.walletId);
      if (!p) throw new Error("Wallet unavailable");
      return solanaSignMessage(p, message);
    }
    const p = getEvmProvider(wallet.walletId);
    if (!p) throw new Error("Wallet unavailable");
    return evmSignMessage(p, wallet.address, message);
  }, [wallet]);

  // One layer: signing out ends the verified session AND disconnects the wallet.
  const signOut = useCallback(async () => { await disconnect(); await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); setSession(null); }, [disconnect]);

  sessionRef.current = session;
  const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const authenticated = !!session && (!wallet || same(session.address, wallet.address));
  const needsAuth = !!wallet && verified.current && sessionLoaded && !restoring && !connecting && !same(session?.address, wallet.address);

  // Wallet switched to another account while signed in: the old session must not carry over to the new account.
  useEffect(() => {
    if (wallet && verified.current && session && !same(session.address, wallet.address)) {
      fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      setSession(null);
    }
  }, [wallet, session]);

  const value = useMemo<WalletContextValue>(() => ({
    wallet, session, connecting, error, modalOpen, restoring, authenticated, needsAuth, sessionLoaded,
    authenticate: () => signInWith(walletRef.current),
    openModal: () => { setError(null); setModalOpen(true); },
    closeModal: () => setModalOpen(false),
    connect: async (id, ct, name) => { await connect(id, ct, name); },
    disconnect, signIn, signOut, signMessage, solana, evm, clearError: () => setError(null), sync, syncing,
  }), [wallet, session, connecting, error, modalOpen, restoring, authenticated, needsAuth, sessionLoaded, signInWith, connect, disconnect, signIn, signOut, signMessage, solana, evm, sync, syncing]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { SOLANA_WALLETS };

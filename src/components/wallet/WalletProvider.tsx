"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getSolanaProvider, solanaSignMessage, SOLANA_WALLETS, type InjectedSolana } from "@/lib/wallet/solana";
import { evmDiscovery, evmSignMessage, getEvmProvider, startEvmDiscovery, type Eip1193 } from "@/lib/wallet/evm";
import type { ConnectedWallet } from "@/lib/wallet/types";
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
  solana: () => InjectedSolana | undefined;
  evm: () => Eip1193 | undefined;
  clearError: () => void;
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
  const cleanup = useRef<(() => void) | null>(null);

  const solana = useCallback(() => (wallet?.chainType === "solana" ? getSolanaProvider(wallet.walletId) : undefined), [wallet]);
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

  const connect = useCallback(async (walletId: string, chainType: ChainType, name: string, silent = false) => {
    setError(null);
    setConnecting(walletId);
    try {
      if (chainType === "solana") {
        const p = getSolanaProvider(walletId);
        if (!p) throw new Error(`${name} is not installed`);
        const res = await p.connect(silent ? { onlyIfTrusted: true } : undefined);
        const pk = (res && "publicKey" in res ? res.publicKey : p.publicKey)?.toString();
        if (!pk) throw new Error("No account returned");
        setWallet({ walletId, walletName: name, chainType, address: pk });
      } else {
        const p = getEvmProvider(walletId);
        if (!p) throw new Error(`${name} is not installed`);
        const accounts = (await p.request({ method: silent ? "eth_accounts" : "eth_requestAccounts" })) as string[];
        if (!accounts?.[0]) throw new Error("No account returned");
        const chainId = Number((await p.request({ method: "eth_chainId" })) as string);
        setWallet({ walletId, walletName: name, chainType, address: accounts[0], chainId });
      }
      try { localStorage.setItem(LAST, JSON.stringify({ walletId, chainType, name })); } catch { /* ignore */ }
      attachListeners(walletId, chainType, name);
      setModalOpen(false);
    } catch (e) {
      if (!silent) setError(friendlyError(e));
    } finally {
      setConnecting(null);
    }
  }, [attachListeners]);

  // Eager reconnect for previously-approved wallets (no popup).
  useEffect(() => {
    startEvmDiscovery();
    fetch("/api/auth/session").then((r) => r.json()).then((b) => setSession(b.session ?? null)).catch(() => {});
    let last: { walletId: string; chainType: ChainType; name: string } | null = null;
    try { last = JSON.parse(localStorage.getItem(LAST) ?? "null"); } catch { /* ignore */ }
    if (last) {
      const l = last;
      const t = setTimeout(() => connect(l.walletId, l.chainType, l.name, true), 400);
      return () => clearTimeout(t);
    }
    return () => cleanup.current?.();
  }, [connect]);

  const disconnect = useCallback(async () => {
    try { await getSolanaProvider(wallet?.walletId ?? "")?.disconnect(); } catch { /* ignore */ }
    cleanup.current?.();
    setWallet(null);
    try { localStorage.removeItem(LAST); } catch { /* ignore */ }
    if (session) { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); setSession(null); }
  }, [wallet, session]);

  const signIn = useCallback(async () => {
    if (!wallet) return;
    setError(null);
    try {
      const n = await fetch(`/api/auth/nonce?chainType=${wallet.chainType}&address=${encodeURIComponent(wallet.address)}`).then((r) => r.json());
      if (!n.message) throw new Error(n.error ?? "Could not start sign-in");
      let signature: string;
      if (wallet.chainType === "solana") {
        const p = getSolanaProvider(wallet.walletId);
        if (!p) throw new Error("Wallet unavailable");
        signature = await solanaSignMessage(p, n.message);
      } else {
        const p = getEvmProvider(wallet.walletId);
        if (!p) throw new Error("Wallet unavailable");
        signature = await evmSignMessage(p, wallet.address, n.message);
      }
      const v = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature }) }).then((r) => r.json());
      if (!v.ok) throw new Error(v.error ?? "Verification failed");
      setSession(v.session);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [wallet]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setSession(null);
  }, []);

  const value = useMemo<WalletContextValue>(() => ({
    wallet, session, connecting, error, modalOpen,
    openModal: () => { setError(null); setModalOpen(true); },
    closeModal: () => setModalOpen(false),
    connect: (id, ct, name) => connect(id, ct, name),
    disconnect, signIn, signOut, solana, evm, clearError: () => setError(null),
  }), [wallet, session, connecting, error, modalOpen, connect, disconnect, signIn, signOut, solana, evm]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { SOLANA_WALLETS };

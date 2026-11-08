"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Lock, PieChart, History, Settings } from "lucide-react";
import { Skeleton, Tabs } from "../ui/primitives";
import { useBajar } from "./useBajar";
import { Onboard, Unlock } from "./Onboard";
import { WalletDashboard } from "./WalletDashboard";
import { lock, touch } from "@/lib/bajar/session";

// Heavier views (signing libraries, QR encoder) load only when opened.
const loading = () => <Skeleton className="h-64 w-full max-w-xl" />;
const SendPanel = dynamic(() => import("./SendPanel").then((m) => m.SendPanel), { loading });
const ReceivePanel = dynamic(() => import("./ReceivePanel").then((m) => m.ReceivePanel), { loading });
const BajarSwap = dynamic(() => import("./BajarSwap").then((m) => m.BajarSwap), { loading });
const ActivityPanel = dynamic(() => import("./ActivityPanel").then((m) => m.ActivityPanel), { loading });
const WalletSettings = dynamic(() => import("./WalletSettings").then((m) => m.WalletSettings), { loading });

/** Three places to be (tabs) and three things to do (actions, opened over the dashboard). */
type Tab = "portfolio" | "activity" | "settings";
type Action = "send" | "receive" | "swap";
export type WalletView = Tab | Action;
const TABS: Tab[] = ["portfolio", "activity", "settings"];
const ACTIONS: Action[] = ["send", "receive", "swap"];
const ACTION_TITLE: Record<Action, string> = { send: "Send", receive: "Receive", swap: "Swap" };

/** View lives in the URL hash, so the phone's back button closes Send/Receive/Swap. */
function useView(): [WalletView, (v: WalletView) => void, () => void] {
  const read = (): WalletView => {
    const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
    return (TABS as string[]).includes(h) || (ACTIONS as string[]).includes(h) ? (h as WalletView) : "portfolio";
  };
  const [view, setView] = useState<WalletView>("portfolio");
  const pushed = useRef(false);
  useEffect(() => {
    setView(read());
    const on = () => setView(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((v: WalletView) => {
    const url = v === "portfolio" ? window.location.pathname + window.location.search : `#${v}`;
    // Actions push history (Back closes them); switching tabs replaces it.
    const isAction = (ACTIONS as string[]).includes(v);
    if (isAction && !pushed.current) { window.history.pushState(null, "", url); pushed.current = true; }
    else window.history.replaceState(null, "", url);
    if (!isAction) pushed.current = false;
    setView(v);
    window.scrollTo({ top: 0 });
  }, []);
  // Close an action: step back if we opened it (keeps history clean), else just show the dashboard.
  const close = useCallback(() => {
    if (pushed.current) { pushed.current = false; window.history.back(); } else go("portfolio");
  }, [go]);
  useEffect(() => { const on = () => { if (!(ACTIONS as string[]).includes(window.location.hash.slice(1))) pushed.current = false; }; window.addEventListener("popstate", on); return () => window.removeEventListener("popstate", on); }, []);
  return [view, go, close];
}

export function WalletApp() {
  const { hasVault, unlocked, accounts } = useBajar();
  const [mounted, setMounted] = useState(false);
  const [view, go, close] = useView();
  // Keep the onboarding flow on screen (incl. its "done" step) until the user leaves it.
  const [onboarding, setOnboarding] = useState(false);
  useEffect(() => { if (mounted && !hasVault) setOnboarding(true); }, [mounted, hasVault]);
  useEffect(() => { setMounted(true); (window as Window & { __bajarLoad?: boolean }).__bajarLoad = true; window.dispatchEvent(new Event("bajar:load")); }, []);
  useEffect(() => {
    if (!unlocked) return;
    const onAct = () => touch();
    window.addEventListener("pointerdown", onAct);
    window.addEventListener("keydown", onAct);
    return () => { window.removeEventListener("pointerdown", onAct); window.removeEventListener("keydown", onAct); };
  }, [unlocked]);

  // Hide the site footer while the wallet is unlocked (app view, not a marketing page).
  const appView = mounted && hasVault && !onboarding && unlocked && !!accounts;
  useEffect(() => {
    if (!appView) return;
    document.documentElement.setAttribute("data-app-view", "wallet");
    return () => document.documentElement.removeAttribute("data-app-view");
  }, [appView]);

  if (!mounted) return <div className="mx-auto max-w-5xl py-2" />;
  if (!hasVault || onboarding) return <div className="mx-auto max-w-5xl py-1 sm:py-2"><Onboard onFinish={() => setOnboarding(false)} /></div>;
  if (!unlocked || !accounts) return <div className="mx-auto max-w-5xl py-1 sm:py-2"><Unlock /></div>;

  const action = (ACTIONS as string[]).includes(view) ? (view as Action) : null;
  const tab: Tab = action ? "portfolio" : (view as Tab);

  return (
    <div className="mx-auto max-w-5xl py-1 sm:py-2 space-y-4" data-testid="wallet-dashboard">
      {action ? (
        <>
          <div className="flex items-center gap-2">
            <button onClick={close} className="h-9 w-9 -ml-1 grid place-items-center rounded-full hover:bg-surface-2" aria-label="Back to wallet" data-testid="wallet-back"><ArrowLeft size={18} /></button>
            <h1 className="text-xl">{ACTION_TITLE[action]}</h1>
          </div>
          {action === "send" && <SendPanel />}
          {action === "receive" && <ReceivePanel />}
          {action === "swap" && <BajarSwap />}
        </>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <h1 className="text-xl">Wallet</h1>
            <span className="text-[11px] text-muted font-mono hidden sm:inline" title="Post-quantum (ML-DSA-65) identity used for sign-in, backups and authorization records">ID {accounts.pq.fingerprint.split(":").pop()?.slice(0, 8)}</span>
            <button onClick={() => lock()} data-testid="bajar-lock" className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-line text-sm hover:bg-surface-2"><Lock size={14} />Lock</button>
          </div>
          <Tabs<Tab> value={tab} onChange={(t) => go(t)} className="w-full sm:w-fit [&>button]:flex-1 sm:[&>button]:flex-none" tabs={[
            { id: "portfolio", label: <span className="inline-flex items-center gap-1.5"><PieChart size={14} />Portfolio</span> },
            { id: "activity", label: <span className="inline-flex items-center gap-1.5"><History size={14} />Activity</span> },
            { id: "settings", label: <span className="inline-flex items-center gap-1.5"><Settings size={14} />Settings</span> },
          ]} />
          {tab === "portfolio" && <WalletDashboard go={go} />}
          {tab === "activity" && <ActivityPanel />}
          {tab === "settings" && <WalletSettings />}
        </>
      )}
    </div>
  );
}

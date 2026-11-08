"use client";
import { useEffect, useState } from "react";
import { Lock, Wallet, Send, QrCode, Repeat, History, ShieldCheck } from "lucide-react";
import { Button, Tabs, Badge } from "../ui/primitives";
import { useBajar } from "./useBajar";
import { Onboard, Unlock } from "./Onboard";
import dynamic from "next/dynamic";
import { PortfolioPanel } from "./PortfolioPanel";
import { Skeleton } from "../ui/primitives";

// Heavier tabs (signing libraries, QR encoder) load only when opened.
const loading = () => <Skeleton className="h-64 w-full max-w-xl" />;
const SendPanel = dynamic(() => import("./SendPanel").then((m) => m.SendPanel), { loading });
const ReceivePanel = dynamic(() => import("./ReceivePanel").then((m) => m.ReceivePanel), { loading });
const BajarSwap = dynamic(() => import("./BajarSwap").then((m) => m.BajarSwap), { loading });
const ActivityPanel = dynamic(() => import("./ActivityPanel").then((m) => m.ActivityPanel), { loading });
const SecurityPanel = dynamic(() => import("./SecurityPanel").then((m) => m.SecurityPanel), { loading });
import { lock, touch } from "@/lib/bajar/session";

type Tab = "portfolio" | "send" | "receive" | "swap" | "activity" | "security";

export function WalletApp() {
  const { hasVault, unlocked, accounts } = useBajar();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("portfolio");
  useEffect(() => { setMounted(true); window.dispatchEvent(new Event("bajar:load")); }, []);
  useEffect(() => {
    if (!unlocked) return;
    const onAct = () => touch();
    window.addEventListener("pointerdown", onAct);
    window.addEventListener("keydown", onAct);
    return () => { window.removeEventListener("pointerdown", onAct); window.removeEventListener("keydown", onAct); };
  }, [unlocked]);

  if (!mounted) return <div className="mx-auto max-w-5xl py-2" />;
  return (
    <div className="mx-auto max-w-5xl py-1 sm:py-2 space-y-4">
      {!hasVault ? <Onboard /> : !unlocked || !accounts ? <Unlock /> : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold inline-flex items-center gap-2"><Wallet size={20} className="text-brand" />Bajar Wallet</h1>
            <Badge tone="up">Unlocked</Badge>
            <Badge tone="ai" title="ML-DSA-65 protects sign-in, backups and authorization records. Blockchain transactions use each network's own signature scheme.">PQ identity {accounts.pq.fingerprint.split(":").pop()?.slice(0, 8)}</Badge>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => lock()} data-testid="bajar-lock"><Lock size={14} className="mr-1" />Lock</Button>
          </div>
          <Tabs<Tab> value={tab} onChange={setTab} className="overflow-x-auto" tabs={[
            { id: "portfolio", label: <span className="inline-flex items-center gap-1"><Wallet size={14} />Assets</span> },
            { id: "send", label: <span className="inline-flex items-center gap-1"><Send size={14} />Send</span> },
            { id: "receive", label: <span className="inline-flex items-center gap-1"><QrCode size={14} />Receive</span> },
            { id: "swap", label: <span className="inline-flex items-center gap-1"><Repeat size={14} />Swap</span> },
            { id: "activity", label: <span className="inline-flex items-center gap-1"><History size={14} />Activity</span> },
            { id: "security", label: <span className="inline-flex items-center gap-1"><ShieldCheck size={14} />Security</span> },
          ]} />
          {tab === "portfolio" && <PortfolioPanel onAction={setTab} />}
          {tab === "send" && <SendPanel />}
          {tab === "receive" && <ReceivePanel />}
          {tab === "swap" && <BajarSwap />}
          {tab === "activity" && <ActivityPanel />}
          {tab === "security" && <SecurityPanel />}
        </>
      )}
    </div>
  );
}

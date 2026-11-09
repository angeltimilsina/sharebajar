"use client";
import { useEffect, useState } from "react";
import { ShieldCheck, ExternalLink, Loader2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Badge, Notice } from "../ui/primitives";
import { useEvmWallets, useWallet } from "./WalletProvider";
import { SOLANA_WALLETS } from "@/lib/wallet/solana";
import { ICONS } from "@/lib/wallet/icons";
import type { ChainType } from "@/lib/types";
import { hasDeepLink, isMobileBrowser, MOBILE_ONLY_EVM, walletDeepLink } from "@/lib/wallet/mobile";
import { walletLogo } from "@/lib/logos";

interface Row { id: string; name: string; icon: string; chainType: ChainType | "native"; installed: boolean; installUrl?: string; soon?: boolean; note?: string }

export function WalletModal() {
  const { modalOpen, closeModal, connect, connecting, error } = useWallet();
  const evm = useEvmWallets();
  const [solInstalled, setSolInstalled] = useState<Record<string, boolean>>({});
  const [legacyEth, setLegacyEth] = useState(false);
  const [bajarReady, setBajarReady] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    if (!modalOpen) return;
    setSolInstalled(Object.fromEntries(SOLANA_WALLETS.map((w) => [w.id, Boolean(w.get())])));
    setLegacyEth(Boolean(window.ethereum));
    setMobile(isMobileBrowser());
    // Unlocked state lives in memory, so it can only be true once the wallet modules are loaded.
    let vault = false;
    try { vault = !!localStorage.getItem("bajar.vault.v1"); } catch { /* ignore */ }
    if (vault) { (window as Window & { __bajarLoad?: boolean }).__bajarLoad = true; window.dispatchEvent(new Event("bajar:load")); import("@/lib/bajar/session").then((m) => setBajarReady(m.bajar.isUnlocked())).catch(() => {}); }
  }, [modalOpen]);

  const hasMetaMask = evm.some((w) => w.info.rdns === "io.metamask") || (legacyEth && Boolean(window.ethereum?.isMetaMask));
  const rows: Row[] = [
    { id: "bajar", name: "Bajar Wallet · Solana", icon: ICONS.bajar, chainType: "solana", installed: bajarReady, installUrl: "/wallet", note: bajarReady ? "Noncustodial · keys stay in this browser" : "Create or unlock at /wallet" },
    { id: "bajar.evm", name: "Bajar Wallet · EVM", icon: ICONS.bajar, chainType: "evm", installed: bajarReady, installUrl: "/wallet", note: bajarReady ? "Ethereum, Base, Arbitrum and more" : "Create or unlock at /wallet" },
    ...SOLANA_WALLETS.filter((w) => w.id !== "bajar").map((w) => ({ id: w.id, name: w.name, icon: ICONS[w.id as keyof typeof ICONS], chainType: "solana" as const, installed: !!solInstalled[w.id], installUrl: w.installUrl })),
    { id: "io.metamask", name: "MetaMask", icon: evm.find((w) => w.info.rdns === "io.metamask")?.info.icon ?? ICONS.metamask, chainType: "evm", installed: hasMetaMask, installUrl: "https://metamask.io/download/" },
    ...evm.filter((w) => w.info.rdns !== "io.metamask").map((w) => ({ id: w.info.rdns, name: w.info.name, icon: w.info.icon, chainType: "evm" as const, installed: true })),
  ];
  if (!evm.length && legacyEth && !hasMetaMask) rows.push({ id: "injected", name: "Browser wallet", icon: ICONS.evm, chainType: "evm", installed: true });
  // Phones: wallets without an extension are reached through their app's browser.
  if (mobile) for (const w of MOBILE_ONLY_EVM) if (!rows.some((r) => r.id === w.id)) rows.push({ id: w.id, name: w.name, icon: walletLogo(w.id) ?? ICONS.evm, chainType: "evm", installed: false });
  const viaApp = (r: Row) => mobile && !r.installed && hasDeepLink(r.id);

  return (
    <Modal open={modalOpen} onClose={closeModal} title="Connect a wallet">
      <div className="px-5 pb-5">
        <p className="text-xs text-muted mb-3">Connect to view balances, sign in and trade. Bajar never takes custody of your funds.</p>
        {mobile && <p className="text-xs text-muted mb-3 -mt-1">On your phone, choosing Phantom, MetaMask or another app opens Bajar inside that wallet, then asks you to connect.</p>}
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                disabled={r.soon || (!r.installed && !r.installUrl && !viaApp(r)) || !!connecting}
                data-testid={`wallet-option-${r.id}`}
                onClick={() => {
                  if (r.soon) return;
                  // Phone without the extension: open this page inside the wallet app (same tab = universal link).
                  if (viaApp(r)) { const link = walletDeepLink(r.id); if (link) { window.location.href = link; return; } }
                  if (!r.installed && r.installUrl) { if (r.installUrl.startsWith("/")) { closeModal(); window.location.href = r.installUrl; } else window.open(r.installUrl, "_blank", "noopener,noreferrer"); return; }
                  connect(r.id, r.chainType as ChainType, r.name);
                }}
                className="w-full flex items-center gap-3 rounded-xl border border-line bg-surface-2/70 hover:bg-surface-3 px-3 py-2.5 text-left transition-colors disabled:opacity-60 disabled:hover:bg-surface-2/70"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.icon} alt="" width={32} height={32} className="rounded-lg" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold">{r.name}</span>
                  <span className="block text-[11px] text-muted">{viaApp(r) ? `Opens Bajar in the ${r.name} app` : r.note ?? (r.chainType === "solana" ? "Solana" : "Ethereum & EVM chains")}</span>
                </span>
                {connecting === r.id ? <Loader2 size={16} className="animate-spin text-muted" />
                  : r.soon ? <Badge tone="brand">Coming soon</Badge>
                  : r.installed ? <Badge tone="up">Detected</Badge>
                  : viaApp(r) ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand">Open app <ExternalLink size={11} /></span>
                  : <span className="inline-flex items-center gap-1 text-[11px] text-muted">Install <ExternalLink size={11} /></span>}
              </button>
            </li>
          ))}
        </ul>
        {error && <Notice tone="down" className="mt-3">{error}</Notice>}
        <div className="mt-4 flex gap-2 text-[11px] text-muted leading-relaxed">
          <ShieldCheck size={15} className="text-brand shrink-0 mt-0.5" />
          <span>Bajar will <b className="text-fg">never</b> ask for your seed phrase or private key. Every signature and transaction requires your explicit approval inside your wallet.</span>
        </div>
      </div>
    </Modal>
  );
}

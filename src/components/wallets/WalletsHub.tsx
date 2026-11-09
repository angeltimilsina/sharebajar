"use client";
import { useMemo, useState } from "react";
import { ArrowLeftRight, Check, Pencil, Plus, Trash2, Wallet, X } from "lucide-react";
import { useRegistry, useWalletBalances, type WalletBalance } from "@/hooks/useWallets";
import { detectWatchAddress, registry, shortAddr, type TrackedWallet } from "@/lib/wallets/registry";
import { formatUsd } from "@/lib/format";
import { Button, Card, CardHeader, Notice } from "../ui/primitives";
import { ChainIcon } from "../ui/ChainIcon";
import { useWallet } from "../wallet/WalletProvider";
import { CrossWalletTransfer } from "./CrossWalletTransfer";

const CHAIN_ICON: Record<string, string> = { solana: "solana", evm: "ethereum", bitcoin: "bitcoin" };
const CHAIN_NAME: Record<string, string> = { solana: "Solana", evm: "EVM", bitcoin: "Bitcoin" };
const SOURCE: Record<string, string> = { connected: "Connected", bajar: "Bajar Wallet", watch: "Watch-only" };

/** Wallets you track, wallet maps (named groups) and moving assets between them. */
export function WalletsHub() {
  const { wallets } = useRegistry();
  const bal = useWalletBalances(wallets);
  const byId = useMemo(() => new Map(bal.balances.map((b) => [b.wallet.id, b])), [bal.balances]);
  const { openModal } = useWallet();

  return (
    <div className="space-y-6" data-testid="wallets-hub">
      <div>
        <h1 className="text-[30px] sm:text-[34px] leading-tight">Wallets</h1>
        <p className="text-muted text-[14.5px] mt-1">Every wallet you use, in one place. Move assets between them — you approve each transfer in the sending wallet.</p>
      </div>

      <div className="panel p-5 flex flex-wrap items-end gap-4">
        <div>
          <div className="text-[13px] text-muted">Total across {wallets.length} wallet{wallets.length === 1 ? "" : "s"}</div>
          <div className="text-[34px] font-semibold num leading-tight" data-testid="hub-total">{formatUsd(bal.total)}</div>
        </div>
        <div className="flex-1" />
        <Button variant="outline" onClick={openModal}><Wallet size={15} /> Connect another wallet</Button>
      </div>

      <WalletList wallets={wallets} byId={byId} />
      <AddWatch />
      <Card id="move" className="scroll-mt-24">
        <CardHeader title={<span className="inline-flex items-center gap-2"><ArrowLeftRight size={17} className="text-brand" />Move between wallets</span>} sub="Pick a source and destination on the same network" />
        <CrossWalletTransfer wallets={wallets} balances={bal.balances} className="px-4 sm:px-5 pb-5" />
      </Card>
      <p className="text-[12px] text-faint">Wallets are stored only in this browser. Balances are read from each network using public addresses — Bajar can&apos;t move anything without your wallet&apos;s approval.</p>
    </div>
  );
}

function WalletList({ wallets, byId }: { wallets: TrackedWallet[]; byId: Map<string, WalletBalance> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  if (!wallets.length) return <Notice title="No wallets yet">Connect a wallet or add a watch-only address below.</Notice>;
  return (
    <Card>
      <CardHeader title="Your wallets" sub="Connected, Bajar Wallet and watch-only addresses" />
      <ul className="divide-y divide-line/70" data-testid="hub-wallets">
        {wallets.map((w) => {
          const b = byId.get(w.id);
          return (
            <li key={w.id} className="flex items-center gap-3 px-4 sm:px-5 py-3">
              <span className="h-9 w-9 rounded-full bg-surface-2 grid place-items-center shrink-0"><ChainIcon chain={CHAIN_ICON[w.chain]} size={18} /></span>
              <div className="min-w-0 flex-1">
                {editing === w.id ? (
                  <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); registry.rename(w.id, label); setEditing(null); }}>
                    <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} className="no-ring min-w-0 flex-1 h-8 rounded-lg bg-surface-2 px-2 text-[16px] sm:text-sm outline-none" aria-label="Wallet name" />
                    <button className="text-up" aria-label="Save"><Check size={16} /></button>
                    <button type="button" className="text-muted" aria-label="Cancel" onClick={() => setEditing(null)}><X size={16} /></button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1.5 text-[14.5px] font-semibold min-w-0">
                    <span className="truncate">{w.label}</span>
                    <button onClick={() => { setEditing(w.id); setLabel(w.label); }} aria-label={`Rename ${w.label}`} className="text-faint hover:text-fg"><Pencil size={12} /></button>
                  </div>
                )}
                <div className="text-[12px] text-muted">{CHAIN_NAME[w.chain]} · {SOURCE[w.source]} · <span className="num">{shortAddr(w.address)}</span></div>
              </div>
              <div className="text-right num text-[14.5px] font-medium">{b ? (b.error ? <span className="text-[12px] text-down">Unavailable</span> : formatUsd(b.totalUsd)) : <span className="text-faint">…</span>}</div>
              <button onClick={() => registry.remove(w.id)} aria-label={`Remove ${w.label}`} className="text-faint hover:text-down"><Trash2 size={14} /></button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function AddWatch() {
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card id="add" className="scroll-mt-24">
      <CardHeader title="Add a watch-only address" sub="Track any Bitcoin, EVM or Solana address. Watch-only wallets can receive but never send from Bajar." />
      <form className="px-4 sm:px-5 pb-5 flex flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault();
        const d = detectWatchAddress(addr);
        if (!d) { setErr("That doesn't look like a Bitcoin, EVM or Solana address."); return; }
        registry.upsert({ address: d.address, chain: d.chain, label: label.trim() || `${CHAIN_NAME[d.chain]} ${shortAddr(d.address)}`, source: "watch" });
        setAddr(""); setLabel(""); setErr(null);
      }}>
        <input value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="Address" aria-label="Watch address" className="no-ring flex-[2] min-w-[220px] h-11 rounded-xl bg-surface-2 px-3 text-[16px] sm:text-sm num outline-none" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name (optional)" aria-label="Watch name" maxLength={40} className="no-ring flex-1 min-w-[140px] h-11 rounded-xl bg-surface-2 px-3 text-[16px] sm:text-sm outline-none" />
        <Button type="submit" className="h-11" data-testid="watch-add"><Plus size={15} /> Add</Button>
        {err && <p className="w-full text-[12px] text-down">{err}</p>}
      </form>
    </Card>
  );
}

"use client";
import { useEffect, useState } from "react";
import { Check, Copy, Loader2, ShieldCheck } from "lucide-react";
import { Button, Notice } from "../ui/primitives";
import { LogoMark } from "../ui/Logo";
import { useBajar } from "../bajar/useBajar";
import { Unlock } from "../bajar/Onboard";
import { currentSession, hybridSignIn } from "@/lib/bajar/auth";

/**
 * Admin sign-in with Bajar Wallet: unlock it here, then a hybrid
 * (Ed25519 + ML-DSA-65) sign-in. The admin identity is the Bajar Wallet's
 * Solana address, so that address must be listed in TREASURY_OWNERS (or added
 * as an admin by an owner).
 */
export function BajarAdminSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { hasVault, unlocked, accounts } = useBajar();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sessionAddr, setSessionAddr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { currentSession().then((s) => setSessionAddr(s?.address ?? null)); }, [busy]);
  const addr = accounts?.solana.address;
  const signedInHere = !!addr && sessionAddr === addr;

  if (!hasVault) return <p className="text-[13px] text-muted">No Bajar Wallet on this device yet. <a className="underline" href="/wallet">Create one</a>, then come back.</p>;
  if (!unlocked || !accounts) return <div className="text-left"><Unlock /></div>;

  return (
    <div className="space-y-3 text-left">
      <div className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5">
        <LogoMark size={26} />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">Bajar Wallet</div>
          <div className="text-[11.5px] text-muted font-mono truncate" data-testid="bajar-admin-address">{addr}</div>
        </div>
        <button aria-label="Copy address" onClick={() => { navigator.clipboard?.writeText(addr!); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="text-muted hover:text-fg">{copied ? <Check size={14} className="text-up" /> : <Copy size={14} />}</button>
      </div>
      {!signedInHere ? (
        <Button className="w-full" disabled={busy} data-testid="bajar-admin-signin" onClick={async () => {
          setBusy(true); setErr(null);
          try { await hybridSignIn(); onSignedIn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Sign in with Bajar Wallet</Button>
      ) : (
        <Notice tone="warn" title="Signed in, but not a treasury admin">This Bajar Wallet address isn&apos;t authorized. Add it to <code>TREASURY_OWNERS</code> in the server environment (or ask an owner to add it as an admin), then reload.</Notice>
      )}
      {err && <Notice tone="down">{err}</Notice>}
    </div>
  );
}

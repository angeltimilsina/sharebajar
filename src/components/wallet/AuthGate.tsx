"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useWallet } from "./WalletProvider";
import { useBajar } from "../bajar/useBajar";
import { hybridSignIn } from "@/lib/bajar/auth";
import { lock } from "@/lib/bajar/session";
import { shortAddress } from "@/lib/format";

/**
 * The visible side of Bajar's single authentication gateway.
 *  - A connected wallet whose signature isn't verified for this session
 *    (account switched, session expired or revoked) gets one prompt to verify.
 *  - An unlocked Bajar Wallet without a session is asked to verify with its
 *    hybrid Ed25519 + ML-DSA-65 signature (or lock), outside the wallet page,
 *    which has its own sign-in step.
 */
export function AuthGate() {
  const { wallet, session, sessionLoaded, needsAuth, authenticate, disconnect, error } = useWallet();
  const [err, setErr] = useState<string | null>(null);
  const { unlocked, accounts } = useBajar();
  const [busy, setBusy] = useState(false);
  const path = usePathname();
  const bajarAddr = accounts?.solana.address ?? null;
  const bajarNeedsAuth = !wallet && unlocked && !!bajarAddr && sessionLoaded && session?.address !== bajarAddr && !/^\/(wallet|admin)/.test(path);

  if (bajarNeedsAuth) {
    return (
      <Gate title={`Verify Bajar Wallet ${shortAddress(bajarAddr!)}`} body="Bajar signs you in with your wallet's Ed25519 + ML-DSA-65 signatures — no transaction, no fees." busy={busy} error={err}
        onVerify={async () => { setBusy(true); setErr(null); try { await hybridSignIn(); } catch (e) { setErr((e as Error).message); } setBusy(false); }}
        onCancel={() => lock()} cancelLabel="Lock wallet" />
    );
  }
  if (!needsAuth || !wallet) return null;
  return (
    <Gate title={`Verify ${shortAddress(wallet.address)} to continue`} body="Bajar signs you in with one wallet signature — no transaction, no fees. Until then your account stays locked." busy={busy} error={error}
      onVerify={async () => { setBusy(true); await authenticate(); setBusy(false); }} onCancel={() => disconnect()} cancelLabel="Disconnect" />
  );
}

function Gate({ title, body, busy, error, onVerify, onCancel, cancelLabel }: { title: string; body: string; busy: boolean; error: string | null; onVerify: () => void; onCancel: () => void; cancelLabel: string }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] md:bottom-6 z-[80] px-4 pointer-events-none" role="dialog" aria-label="Verify your wallet" data-testid="auth-gate">
      <div className="pointer-events-auto mx-auto max-w-md rounded-2xl bg-[var(--surface)] border-[0.5px] border-line shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} className="text-accent shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[14.5px] font-medium">{title}</div>
            <p className="text-[12.5px] text-muted">{body}</p>
            {error && <p className="mt-1 text-[12px] text-down">{error}</p>}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={onVerify} className="flex-1 h-10 rounded-full btn-ink font-medium text-[14px]" data-testid="auth-verify">{busy ? "Check your wallet…" : "Verify wallet"}</button>
          <button type="button" onClick={onCancel} className="h-10 px-4 rounded-full bg-surface-2 text-[13.5px]" data-testid="auth-disconnect">{cancelLabel}</button>
        </div>
      </div>
    </div>
  );
}

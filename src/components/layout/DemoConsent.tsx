"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { LogoMark } from "../ui/Logo";

/**
 * First-visit notice: Bajar is a demo / beta. Visitors must explicitly accept
 * (two checkboxes) before using the app. The choice is remembered in a
 * first-party cookie (1 year); bump VERSION to ask again after changes.
 */
const VERSION = "v1";
const COOKIE = "bajar_consent";

export function DemoConsent() {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  useEffect(() => {
    const has = document.cookie.split("; ").some((c) => c === `${COOKIE}=${VERSION}`);
    if (!has) setOpen(true);
  }, []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  const accept = () => {
    document.cookie = `${COOKIE}=${VERSION}; Max-Age=${365 * 24 * 3600}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    try { localStorage.setItem("bajar.consent", JSON.stringify({ version: VERSION, at: new Date().toISOString() })); } catch { /* ignore */ }
    setOpen(false);
  };
  return (
    <div className="fixed inset-0 z-[300] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="demo-consent-title" data-testid="demo-consent">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[28px] bg-[var(--surface)] p-5 sm:p-6 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <LogoMark size={32} />
          <div>
            <h2 id="demo-consent-title" className="text-[20px] font-semibold leading-tight">Welcome to Bajar (demo)</h2>
            <p className="text-[12.5px] text-muted">Please read and accept before continuing</p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-warn/10 border border-warn/30 p-3 text-[13px] flex gap-2">
          <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" />
          <span>This website is a <b>demo / beta</b> under active development. Features may change, break or be removed, and data may be reset.</span>
        </div>
        <ul className="mt-3 space-y-1.5 text-[13px] text-muted list-disc pl-5">
          <li>Market data comes from third parties and may be delayed or wrong. Nothing here is financial, investment or legal advice.</li>
          <li>If you connect a wallet and sign on a real network (mainnet), transactions use <b>real funds</b> and can&apos;t be reversed.</li>
          <li>Bajar never asks for your recovery phrase or private keys and can&apos;t recover lost funds.</li>
          <li>Launching or trading tokens carries high risk and may have legal obligations where you live.</li>
          <li>To practise safely, use <b>Learn</b> (test coins only).</li>
        </ul>
        <label className="mt-4 flex items-start gap-2.5 text-[13.5px] cursor-pointer">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={a} onChange={(e) => setA(e.target.checked)} data-testid="consent-demo" />
          <span>I understand Bajar is a demo and that nothing here is financial advice.</span>
        </label>
        <label className="mt-2 flex items-start gap-2.5 text-[13.5px] cursor-pointer">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={b} onChange={(e) => setB(e.target.checked)} data-testid="consent-risk" />
          <span>I understand real-network transactions use real funds, are irreversible, and are my responsibility.</span>
        </label>
        <button onClick={accept} disabled={!a || !b} className="mt-4 w-full h-11 rounded-xl btn-ink font-semibold text-[15px] inline-flex items-center justify-center gap-2 disabled:opacity-40" data-testid="consent-accept"><Check size={16} /> I agree, continue</button>
        <p className="mt-2 text-center text-[11.5px] text-faint">We remember your choice on this device with a small cookie.</p>
      </div>
    </div>
  );
}

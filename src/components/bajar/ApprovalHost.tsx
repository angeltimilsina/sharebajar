"use client";
import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button, Notice } from "../ui/primitives";
import type { ApprovalRequest } from "@/lib/bajar/approvals";

type Mod = typeof import("@/lib/bajar/approvals");

/**
 * Renders Bajar Wallet approval prompts. Nothing is signed until Approve is clicked.
 * The wallet modules (keys, crypto, providers) load after first paint so they
 * never weigh on pages that don't use the wallet.
 */
export function ApprovalHost() {
  const [mod, setMod] = useState<Mod | null>(null);
  const [req, setReq] = useState<ApprovalRequest | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    const load = () => Promise.all([import("@/lib/bajar/approvals"), import("@/lib/bajar/providers")]).then(([a, p]) => {
      p.registerBajarProviders();
      setMod(a);
      unsub = a.approvals.subscribe(() => setReq(a.approvals.current()));
      setReq(a.approvals.current());
    }).catch(() => {});
    // Only devices that actually hold a Bajar vault pay for the wallet code;
    // others load it on demand (opening /wallet or the wallet picker).
    let started = false;
    const start = () => { if (!started) { started = true; load(); } };
    let hasVault = false;
    try { hasVault = !!localStorage.getItem("bajar.vault.v1"); } catch { /* storage blocked */ }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (hasVault) { if (w.requestIdleCallback) w.requestIdleCallback(start, { timeout: 2500 }); else setTimeout(start, 800); }
    window.addEventListener("bajar:load", start);
    return () => { unsub?.(); window.removeEventListener("bajar:load", start); };
  }, []);

  if (!req || !mod) return null;
  const settle = mod.settle;
  return (
    <Modal open onClose={() => settle(req.id, false)} title={<span className="inline-flex items-center gap-2"><ShieldCheck size={16} className="text-accent" />Bajar Wallet · {req.title}</span>}>
      <div className="px-5 pb-5 space-y-3" data-testid="bajar-approval">
        <div className="text-xs text-muted">Network: <b className="text-fg">{req.network}</b> · {req.kind === "message" ? "Message signature" : "Transaction signature"}</div>
        <dl className="rounded-xl border border-line divide-y divide-line text-xs">
          {req.rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted shrink-0">{k}</dt><dd className="text-right font-mono break-all">{v}</dd></div>
          ))}
        </dl>
        {req.raw && <pre className="max-h-40 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] whitespace-pre-wrap break-all">{req.raw}</pre>}
        {req.warning && <Notice tone="down" title="Warning"><span className="inline-flex gap-1"><ShieldAlert size={14} />{req.warning}</span></Notice>}
        <p className="text-[11px] text-muted">Signed locally in this browser. Your keys never leave this device. Check every field before approving.</p>
        <div className="flex gap-2 sticky bottom-0">
          <Button variant="outline" className="flex-1 h-11" onClick={() => settle(req.id, false)}>Reject</Button>
          <Button className="flex-1 h-11" onClick={() => settle(req.id, true)} data-testid="bajar-approve">Approve</Button>
        </div>
      </div>
    </Modal>
  );
}

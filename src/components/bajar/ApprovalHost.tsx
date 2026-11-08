"use client";
import { useEffect, useSyncExternalStore } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button, Notice } from "../ui/primitives";
import { approvals, settle } from "@/lib/bajar/approvals";

/** Renders BAJAR Wallet approval prompts. Nothing is signed until Approve is clicked. */
export function ApprovalHost() {
  const req = useSyncExternalStore(approvals.subscribe, approvals.current, () => null);

  // Expose BAJAR providers to the wallet picker (loaded lazily to keep bundles small).
  useEffect(() => {
    import("@/lib/bajar/providers").then((m) => m.registerBajarProviders()).catch(() => {});
  }, []);

  if (!req) return null;
  return (
    <Modal open onClose={() => settle(req.id, false)} title={<span className="inline-flex items-center gap-2"><ShieldCheck size={16} className="text-brand" />BAJAR Wallet · {req.title}</span>}>
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
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => settle(req.id, false)}>Reject</Button>
          <Button className="flex-1" onClick={() => settle(req.id, true)} data-testid="bajar-approve">Approve</Button>
        </div>
      </div>
    </Modal>
  );
}

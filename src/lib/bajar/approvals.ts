"use client";
import { recordAuthorization } from "./session";

/**
 * Every signature BAJAR produces goes through this explicit approval step.
 * The UI (ApprovalHost) renders the request; nothing signs until the user
 * clicks Approve. Approved requests are also logged with an ML-DSA-65
 * signature (supplementary authorization record — not a chain signature).
 */
export interface ApprovalRequest {
  id: number;
  kind: "message" | "transaction";
  network: string;
  title: string;
  rows: [string, string][];
  warning?: string;
  raw?: string;
}

type Pending = ApprovalRequest & { resolve: (ok: boolean) => void };
let queue: Pending[] = [];
const subs = new Set<() => void>();
let seq = 1;

export const approvals = {
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
  current: () => queue[0] ?? null,
};

export function requestApproval(req: Omit<ApprovalRequest, "id">, payload: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    const item: Pending = { ...req, id: seq++, resolve: (ok) => {
      if (ok) recordAuthorization(req.kind === "message" ? "sign_message" : "sign_transaction", req.network, req.title, payload);
      resolve(ok);
    } };
    queue = [...queue, item];
    subs.forEach((s) => s());
  });
}

export function settle(id: number, ok: boolean) {
  const item = queue.find((q) => q.id === id);
  queue = queue.filter((q) => q.id !== id);
  item?.resolve(ok);
  subs.forEach((s) => s());
}

export class UserRejected extends Error { constructor() { super("User rejected the request in BAJAR Wallet."); this.name = "UserRejected"; } }

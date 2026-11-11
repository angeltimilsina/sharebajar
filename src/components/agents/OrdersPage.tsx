"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Package } from "lucide-react";
import { orderTokens, saveOrderToken, usd } from "@/lib/commerce/client";

interface Order { id: string; sandbox: boolean; status: string; title: string; merchant: string; quantity: number; asset: string; network: string; cryptoAmount: string; totalUsd: number; refundedUsd: number; createdAt: string; events: { at: number; status: string; note: string }[]; token?: string; shipTo?: string }

const LABEL: Record<string, string> = { authorized: "Authorized", confirmed: "Confirmed", shipped: "Shipped", delivered: "Delivered", merchant_failed: "Not confirmed", cancelled: "Cancelled", refunded: "Refunded" };

/** Orders and tracking (#Track). Receipts are kept on this device; signing in shows your wallet's orders everywhere. */
export function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/commerce/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokens: orderTokens() }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setOrders(b.orders);
      for (const o of b.orders as Order[]) if (o.token) saveOrderToken(o.token);
    } catch (e) { setErr(String((e as Error).message || "Orders are unavailable right now.")); setOrders([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function cancel(o: Order) {
    if (!o.token) return;
    setBusy(o.id);
    const r = await fetch("/api/commerce/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: o.token, reason: "Customer request" }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) setErr(b.error ?? "Couldn't cancel this order.");
    setBusy(null);
    load();
  }

  return (
    <div className="mx-auto max-w-[760px] px-4 pb-32 pt-6">
      <Link href="/agents" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft size={14} />BAJAR Agents</Link>
      <h1 className="mt-2 font-display text-[30px]">Orders</h1>
      {err && <div className="mt-3 rounded-xl bg-down/10 text-down px-3 py-2 text-[13px]" data-testid="orders-error">{err}</div>}
      {orders === null ? <div className="mt-6 text-sm text-muted">Loading…</div> : !orders.length ? (
        <div className="mt-10 text-center text-muted"><Package size={28} className="mx-auto mb-2 text-faint" />No orders yet.</div>
      ) : (
        <ul className="mt-4 space-y-3" data-testid="orders">
          {orders.map((o) => (
            <li key={o.id} className="rounded-2xl bg-surface p-4" data-testid="order" data-status={o.status}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14.5px] font-medium leading-snug">{o.title}{o.quantity > 1 ? ` × ${o.quantity}` : ""}</div>
                  <div className="text-[12px] text-faint">{o.merchant} · {new Date(o.createdAt).toLocaleString()}{o.shipTo ? ` · ${o.shipTo}` : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="num font-semibold">{usd(o.totalUsd)}</div>
                  <div className="text-[12px] text-faint num">{o.cryptoAmount} {o.asset}</div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[12.5px]">
                <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium" data-testid="order-status">{LABEL[o.status] ?? o.status}</span>
                {o.sandbox && <span className="rounded bg-warn/15 text-warn px-1.5 py-0.5 text-[11px]">SANDBOX</span>}
                {o.refundedUsd > 0 && <span className="text-up">Refunded {usd(o.refundedUsd)}</span>}
              </div>
              <ol className="mt-3 space-y-1 border-l-[0.5px] border-line pl-3 text-[12.5px] text-muted">
                {o.events.map((e, i) => <li key={i}><span className="text-faint num">{new Date(e.at).toLocaleTimeString()}</span> · {e.note}</li>)}
              </ol>
              {(o.status === "confirmed" || o.status === "authorized") && o.token && (
                <button type="button" onClick={() => cancel(o)} disabled={busy === o.id} className="mt-3 h-9 px-4 rounded-full bg-surface-2 text-[13px] font-medium hover:bg-surface-3" data-testid="cancel-order">{busy === o.id ? "Cancelling…" : "Cancel & refund"}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-[12px] text-faint">Receipts are saved on this device. Sign in with your wallet to see orders you placed on other devices.</p>
    </div>
  );
}

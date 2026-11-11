"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, ShieldCheck, XCircle } from "lucide-react";
import type { Offer } from "@/lib/commerce/types";
import { newIdempotencyKey, saveOrderToken, usd } from "@/lib/commerce/client";
import { useWallet } from "../wallet/WalletProvider";
import { Modal } from "../ui/Modal";
import { SwipeToConfirm } from "../ui/SwipeToConfirm";
import type { Profile } from "./ShoppingProfile";

interface Quote {
  id: string; sandbox: boolean; quantity: number; lines: { label: string; usd: number; note?: string }[]; totalUsd: number; asset: string; network: string;
  cryptoAmount: number; priceSource: string; networkFeeUsd: number; expiresAt: number; message: string; shipping: { label: string };
}
interface Order { id: string; status: string; title: string; totalUsd: number; asset: string; cryptoAmount: string; network: string; sandbox: boolean; token?: string; events: { status: string; note: string }[] }

const SHIP = [{ id: "std", label: "Standard (5–7 days) · Free" }, { id: "exp", label: "Express (2–3 days) · $12" }];

/**
 * "Pay with BAJAR": quote → itemized fees → review → the customer signs the
 * exact quote in their wallet → order → receipt. The agent never pays: the
 * wallet signature is the only thing that authorizes an order.
 */
export function CheckoutSheet({ offer, asset: initialAsset, onClose }: { offer: Offer | null; asset: string; onClose: () => void }) {
  const { wallet, openModal, signMessage, session } = useWallet();
  const signedIn = !!(wallet && session && session.address.toLowerCase() === wallet.address.toLowerCase());
  const [saved, setSaved] = useState<Profile | null>(null);
  const [addrId, setAddrId] = useState<string>("new");
  const [remember, setRemember] = useState(false);
  const [qty, setQty] = useState(1);
  const [ship, setShip] = useState("std");
  const [asset, setAsset] = useState(initialAsset);
  const [addr, setAddr] = useState({ name: "", line1: "", city: "", postal: "", country: "US", email: "" });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<null | "quote" | "sign" | "submit">(null);
  const [err, setErr] = useState<{ code?: string; message: string } | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [now, setNow] = useState(Date.now());
  const idem = useRef(newIdempotencyKey());

  useEffect(() => { if (offer) { setQuote(null); setOrder(null); setErr(null); setConsent(false); setQty(1); idem.current = newIdempotencyKey(); } }, [offer]);
  // Clone the saved shopping profile into the form.
  useEffect(() => {
    if (!offer || !signedIn) { setSaved(null); return; }
    fetch("/api/commerce/profile").then((r) => (r.ok ? r.json() : null)).then((b) => {
      const pr = b?.profile as Profile | undefined;
      if (!pr) return;
      setSaved(pr);
      const a = pr.addresses.find((x) => x.id === pr.defaultAddress) ?? pr.addresses[0];
      if (a) { setAddrId(a.id); setAddr({ name: a.name, line1: a.line1, city: a.city, postal: a.postal, country: a.country, email: pr.email }); }
      else setAddr((x) => ({ ...x, name: x.name || pr.name, email: x.email || pr.email }));
    }).catch(() => {});
  }, [offer, signedIn]);
  const pickAddress = (id: string) => {
    setAddrId(id);
    const a = saved?.addresses.find((x) => x.id === id);
    setAddr(a ? { name: a.name, line1: a.line1, city: a.city, postal: a.postal, country: a.country, email: saved?.email ?? "" } : { name: saved?.name ?? "", line1: "", city: "", postal: "", country: "US", email: saved?.email ?? "" });
  };
  useEffect(() => { setAsset(wallet?.chainType === "evm" && (initialAsset === "SOL") ? "USDC" : wallet?.chainType === "solana" && initialAsset === "ETH" ? "USDC" : initialAsset); }, [initialAsset, wallet?.chainType]);
  useEffect(() => { if (!quote) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [quote]);
  // Any change to what's being bought invalidates the quote.
  useEffect(() => { setQuote(null); setConsent(false); }, [qty, ship, asset]);

  const expired = !!quote && now >= quote.expiresAt;
  const left = quote ? Math.max(0, Math.floor((quote.expiresAt - now) / 1000)) : 0;
  const assets = wallet?.chainType === "evm" ? ["USDC", "USDT", "ETH"] : ["USDC", "USDT", "SOL"];

  async function getQuote() {
    if (!offer || !wallet) return;
    setBusy("quote"); setErr(null);
    try {
      const r = await fetch("/api/commerce/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offerId: offer.id, quantity: qty, shippingId: ship, asset, wallet: wallet.address, chainType: wallet.chainType }) });
      const b = await r.json();
      if (!r.ok) setErr({ code: b.code, message: b.error ?? "Couldn't get a quote." });
      else { setQuote(b.quote); setNow(Date.now()); idem.current = newIdempotencyKey(); }
    } catch { setErr({ message: "Couldn't get a quote. Check your connection." }); }
    setBusy(null);
  }

  async function authorize() {
    if (!quote || expired || !consent) return;
    setErr(null);
    let signature: string;
    setBusy("sign");
    try { signature = await signMessage(quote.message); } catch (e) {
      setBusy(null);
      const m = String((e as Error).message ?? e);
      setErr({ code: "rejected", message: /reject|denied|cancel|declin|4001/i.test(m) ? "You declined the authorization in your wallet. Nothing was charged." : m });
      return;
    }
    setBusy("submit");
    try {
      const r = await fetch("/api/commerce/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: quote.id, signature, idempotencyKey: idem.current, consent: true, shipping: { ...addr, email: addr.email || undefined } }) });
      const b = await r.json();
      if (!r.ok) setErr({ code: b.code, message: b.error ?? "Checkout failed. Nothing was charged." });
      else {
        setOrder(b.order); if (b.order.token) saveOrderToken(b.order.token);
        if (remember && signedIn) {
          const base = saved ?? { name: "", email: "", phone: "", addresses: [], defaultAddress: null, billingSameAsShipping: true };
          const id = `a${Date.now().toString(36)}`;
          const next: Profile = { ...base, name: base.name || addr.name, email: base.email || addr.email, addresses: [...base.addresses, { id, label: base.addresses.length ? "Other" : "Home", name: addr.name, line1: addr.line1, city: addr.city, postal: addr.postal, country: addr.country }].slice(0, 10), defaultAddress: base.defaultAddress ?? id };
          fetch("/api/commerce/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: next }) }).catch(() => {});
        }
      }
    } catch { setErr({ message: "Checkout failed. Nothing was charged." }); }
    setBusy(null);
  }

  const input = "h-10 w-full rounded-xl bg-surface-2 px-3 text-[14px] outline-none focus:ring-2 focus:ring-accent/40";
  return (
    <Modal open={!!offer} onClose={onClose} title="Pay with BAJAR" wide>
      {offer && (
        <div className="px-5 pb-5 space-y-4" data-testid="checkout-sheet">
          {offer.sandbox && <div className="rounded-xl bg-warn/10 text-warn px-3 py-2 text-[12.5px]" data-testid="sandbox-banner">Sandbox checkout with the Bajar Test Store. Your wallet signs a real authorization, but no money moves and nothing ships.</div>}
          {order ? <Receipt order={order} onClose={onClose} /> : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="text-[14.5px] font-medium leading-snug">{offer.title}</div><div className="text-[12.5px] text-faint">{offer.merchant}</div></div>
                <div className="num font-semibold">{usd(offer.price)}</div>
              </div>

              {!wallet ? (
                <button type="button" onClick={openModal} className="w-full h-12 rounded-full btn-ink font-medium">Connect wallet to continue</button>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[12px] text-faint">Quantity<select value={qty} onChange={(e) => setQty(Number(e.target.value))} className={input} data-testid="qty">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                    <label className="text-[12px] text-faint">Pay with<select value={asset} onChange={(e) => setAsset(e.target.value)} className={input} data-testid="pay-asset">{assets.map((a) => <option key={a}>{a}</option>)}</select></label>
                    <label className="col-span-2 text-[12px] text-faint">Delivery<select value={ship} onChange={(e) => setShip(e.target.value)} className={input}>{SHIP.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
                  </div>

                  <fieldset className="grid grid-cols-2 gap-2" data-testid="ship-form">
                    <legend className="text-[12px] text-faint mb-1">Ship to (encrypted; shared only with the merchant)</legend>
                    {saved && saved.addresses.length > 0 && (
                      <select className={`${input} col-span-2`} value={addrId} onChange={(e) => pickAddress(e.target.value)} aria-label="Saved address" data-testid="saved-address">
                        {saved.addresses.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.line1}, {a.city}</option>)}
                        <option value="new">New address…</option>
                      </select>
                    )}
                    <input className={`${input} col-span-2`} placeholder="Full name" aria-label="Full name" value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} autoComplete="name" />
                    <input className={`${input} col-span-2`} placeholder="Street address" aria-label="Street address" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} autoComplete="address-line1" />
                    <input className={input} placeholder="City" aria-label="City" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} autoComplete="address-level2" />
                    <input className={input} placeholder="Postal code" aria-label="Postal code" value={addr.postal} onChange={(e) => setAddr({ ...addr, postal: e.target.value })} autoComplete="postal-code" />
                    <input className={input} placeholder="Country (US)" aria-label="Country" maxLength={2} value={addr.country} onChange={(e) => setAddr({ ...addr, country: e.target.value.toUpperCase() })} autoComplete="country" />
                    <input className={input} placeholder="Email (optional)" aria-label="Email" value={addr.email} onChange={(e) => setAddr({ ...addr, email: e.target.value })} autoComplete="email" />
                    {signedIn && addrId === "new" && <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-muted"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="remember-address" />Save to my shopping profile</label>}
                    {!signedIn && <Link href="/agents/profile" className="col-span-2 text-[12px] text-faint hover:text-fg">Sign in to fill this in from your shopping profile →</Link>}
                  </fieldset>

                  {!quote ? (
                    <button type="button" onClick={getQuote} disabled={busy !== null} className="w-full h-12 rounded-full btn-ink font-medium disabled:opacity-50" data-testid="get-quote">{busy === "quote" ? "Getting quote…" : "Review price"}</button>
                  ) : (
                    <div className="rounded-2xl bg-surface-2 p-4" data-testid="quote">
                      <dl className="space-y-1.5 text-[13.5px]">
                        {quote.lines.map((l) => <div key={l.label} className="flex justify-between gap-3"><dt className="text-muted">{l.label}</dt><dd className="num">{usd(l.usd)}</dd></div>)}
                        <div className="flex justify-between gap-3 border-t-[0.5px] border-line pt-1.5 font-semibold"><dt>Total</dt><dd className="num" data-testid="quote-total">{usd(quote.totalUsd)}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-muted">You pay</dt><dd className="num font-medium">{quote.cryptoAmount} {quote.asset} <span className="text-faint">on {quote.network}</span></dd></div>
                        <div className="flex justify-between gap-3 text-[12px] text-faint"><dt>Network fee (paid to the network, estimate)</dt><dd className="num">≈{usd(quote.networkFeeUsd)}</dd></div>
                        <div className="text-[11.5px] text-faint">Price: {quote.priceSource}</div>
                      </dl>
                      <div className={`mt-3 flex items-center gap-1.5 text-[12.5px] ${expired ? "text-down" : "text-muted"}`} data-testid="quote-timer"><Clock size={13} />{expired ? "Quote expired" : `Quote valid for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}</div>
                      {expired ? (
                        <button type="button" onClick={getQuote} className="mt-3 w-full h-11 rounded-full bg-surface-3 font-medium" data-testid="refresh-quote">Get a new quote</button>
                      ) : (
                        <>
                          <label className="mt-3 flex items-start gap-2 text-[12.5px] text-muted">
                            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" data-testid="consent" />
                            I reviewed the item, fees and total. I&apos;ll authorize this payment myself in my wallet — Bajar agents can&apos;t pay for me.
                          </label>
                          <div className="mt-3">
                            <SwipeToConfirm
                              testId="authorize"
                              label={`Swipe to pay ${quote.cryptoAmount} ${quote.asset}`}
                              busyLabel={busy === "sign" ? "Approve in your wallet…" : "Confirming with merchant…"}
                              busy={busy === "sign" || busy === "submit"}
                              disabled={!consent || busy !== null}
                              onConfirm={authorize}
                            />
                            <div className="mt-1.5 flex items-center justify-center gap-1 text-[11.5px] text-faint"><ShieldCheck size={12} />Your wallet will ask you to approve. Swiping alone pays nothing.</div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
              {err && <div className="rounded-xl bg-down/10 text-down px-3 py-2 text-[13px]" data-testid="checkout-error" data-code={err.code}>{err.message}</div>}
              <p className="text-[11.5px] text-faint">Bajar never asks for your recovery phrase or private keys. Your wallet shows exactly what you&apos;re signing.</p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function Receipt({ order, onClose }: { order: Order; onClose: () => void }) {
  const ok = order.status !== "merchant_failed";
  return (
    <div className="text-center py-2" data-testid="receipt" data-status={order.status}>
      {ok ? <CheckCircle2 size={40} className="mx-auto text-up" /> : <XCircle size={40} className="mx-auto text-down" />}
      <h3 className="mt-2 text-[18px] font-semibold">{ok ? (order.sandbox ? "Sandbox order confirmed" : "Order confirmed") : "Merchant didn't confirm"}</h3>
      <p className="mt-1 text-[13.5px] text-muted">{order.events[order.events.length - 1]?.note}</p>
      <div className="mt-3 rounded-xl bg-surface-2 p-3 text-left text-[13px] space-y-1">
        <div className="flex justify-between"><span className="text-muted">Order</span><span className="num">{order.id}</span></div>
        <div className="flex justify-between"><span className="text-muted">Item</span><span className="truncate ml-3">{order.title}</span></div>
        <div className="flex justify-between"><span className="text-muted">Total</span><span className="num">{usd(order.totalUsd)} · {order.cryptoAmount} {order.asset}</span></div>
        {order.sandbox && <div className="text-warn text-[12px]">Sandbox: no funds moved, nothing ships.</div>}
      </div>
      <div className="mt-4 flex gap-2">
        <Link href="/agents/orders" className="flex-1 h-11 rounded-full bg-surface-2 grid place-items-center font-medium">Track order</Link>
        <button type="button" onClick={onClose} className="flex-1 h-11 rounded-full btn-ink font-medium">Done</button>
      </div>
    </div>
  );
}

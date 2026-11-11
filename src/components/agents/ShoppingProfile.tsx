"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Lock, Plus, ShieldCheck, Store, Trash2 } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";

export interface Address { id: string; label: string; name: string; line1: string; line2?: string; city: string; region?: string; postal: string; country: string; phone?: string }
export interface Profile { name: string; email: string; phone: string; addresses: Address[]; defaultAddress: string | null; billingSameAsShipping: boolean }
interface Connector { id: string; name: string; configured: boolean; missing: string[]; grants: string[] }
interface Account { store: string; accountName: string | null; connectedAt: string }

const EMPTY: Profile = { name: "", email: "", phone: "", addresses: [], defaultAddress: null, billingSameAsShipping: true };
const newAddress = (p: Profile): Address => ({ id: `a${Date.now().toString(36)}`, label: p.addresses.length ? "Other" : "Home", name: p.name, line1: "", city: "", postal: "", country: "US", phone: p.phone || undefined });
const MSG: Record<string, string> = {
  state: "That store sign-in expired or didn't match. Try again.", denied: "You cancelled the store sign-in.", code: "The store didn't return a sign-in code.",
  exchange: "The store sign-in couldn't be completed. Try again.", signin: "Sign in with your wallet first.", not_configured: "This store sign-in isn't set up on this deployment yet.", rate: "Too many attempts. Wait a minute.", unknown: "Unknown store.",
};

/** Shopping profile + store accounts. Agents clone these details into checkouts; stores are connected only through their official sign-in. */
export function ShoppingProfile() {
  const sp = useSearchParams();
  const { wallet, session, signIn, openModal } = useWallet();
  const signedIn = !!(wallet && session && session.address.toLowerCase() === wallet.address.toLowerCase());
  const [p, setP] = useState<Profile | null>(null);
  const [stores, setStores] = useState<{ connectors: Connector[]; accounts: Account[] } | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(() => {
    const c = sp.get("connected"), e = sp.get("error");
    return c ? { tone: "ok", text: `${c === "ebay" ? "eBay" : "Amazon"} connected.${c === "amazon" ? " Your name and email were added where your profile was empty." : ""}` } : e ? { tone: "err", text: MSG[e] ?? "Something went wrong." } : null;
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    fetch("/api/stores").then((r) => r.json()).then(setStores).catch(() => {});
    if (!signedIn) { setP(null); return; }
    const r = await fetch("/api/commerce/profile");
    const b = await r.json().catch(() => ({}));
    if (r.ok) setP({ ...EMPTY, ...b.profile }); else setMsg({ tone: "err", text: b.error ?? "Couldn't load your profile." });
  }, [signedIn]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!p) return;
    setSaving(true); setMsg(null);
    const r = await fetch("/api/commerce/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: p }) });
    const b = await r.json().catch(() => ({}));
    if (r.ok) { setP(b.profile); setMsg({ tone: "ok", text: "Saved. Agents will fill these details in at checkout." }); } else setMsg({ tone: "err", text: b.error ?? "Couldn't save." });
    setSaving(false);
  }
  async function wipe() {
    if (!confirm("Delete your saved name, email, phone and addresses?")) return;
    await fetch("/api/commerce/profile", { method: "DELETE" });
    setP({ ...EMPTY }); setMsg({ tone: "ok", text: "Shopping profile deleted." });
  }
  async function disconnect(store: string) {
    await fetch(`/api/stores?store=${store}`, { method: "DELETE" });
    load();
  }

  const input = "h-10 w-full rounded-xl bg-surface-2 px-3 text-[16px] sm:text-[14px] outline-none focus:ring-2 focus:ring-accent/40";
  const setAddr = (id: string, patch: Partial<Address>) => setP((x) => x && { ...x, addresses: x.addresses.map((a) => (a.id === id ? { ...a, ...patch } : a)) });

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-32 pt-6">
      <Link href="/agents" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft size={14} />BAJAR Agents</Link>
      <h1 className="mt-2 font-display text-[30px]">Shopping profile</h1>
      <p className="text-[13.5px] text-muted">Saved once, cloned into every checkout by your agents. Encrypted, and shared with a store only when you confirm a checkout.</p>
      {msg && <div className={`mt-3 rounded-xl px-3 py-2 text-[13px] ${msg.tone === "ok" ? "bg-up/10 text-up" : "bg-down/10 text-down"}`} data-testid="profile-msg">{msg.text}</div>}

      {!signedIn ? (
        <div className="mt-6 rounded-2xl bg-surface p-5 text-center" data-testid="profile-signin">
          <Lock className="mx-auto text-faint" size={22} />
          <p className="mt-2 text-[14px]">Sign in with your wallet to save your details.</p>
          <p className="text-[12.5px] text-faint">You&apos;ll sign a message — no transaction, no fees.</p>
          <button type="button" onClick={() => (wallet ? signIn() : openModal())} className="mt-3 h-11 px-5 rounded-full btn-ink font-medium" data-testid="profile-signin-btn">{wallet ? "Sign in with wallet" : "Connect wallet"}</button>
        </div>
      ) : !p ? <div className="mt-6 text-sm text-muted">Loading…</div> : (
        <section className="mt-5 space-y-4" data-testid="shopping-profile">
          <div className="rounded-2xl bg-surface p-4 grid gap-2 sm:grid-cols-2">
            <label className="sm:col-span-2 text-[12px] text-faint">Full name<input className={input} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} autoComplete="name" aria-label="Full name" /></label>
            <label className="text-[12px] text-faint">Email<input className={input} type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} autoComplete="email" aria-label="Email" /></label>
            <label className="text-[12px] text-faint">Phone<input className={input} type="tel" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} autoComplete="tel" aria-label="Phone" /></label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between"><h2 className="text-[13px] uppercase tracking-wider text-faint">Shipping addresses</h2>
              <button type="button" onClick={() => setP({ ...p, addresses: [...p.addresses, newAddress(p)] })} disabled={p.addresses.length >= 10} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg" data-testid="add-address"><Plus size={14} />Add</button>
            </div>
            {!p.addresses.length && <div className="rounded-2xl bg-surface p-4 text-[13px] text-muted">No addresses yet.</div>}
            {p.addresses.map((a) => (
              <div key={a.id} className="rounded-2xl bg-surface p-4 grid gap-2 grid-cols-2" data-testid="address">
                <div className="col-span-2 flex items-center gap-2">
                  <input className={`${input} !h-8 max-w-[140px]`} value={a.label} onChange={(e) => setAddr(a.id, { label: e.target.value })} aria-label="Address label" />
                  <label className="inline-flex items-center gap-1.5 text-[12.5px] text-muted"><input type="radio" name="default" checked={p.defaultAddress === a.id || (!p.defaultAddress && p.addresses[0].id === a.id)} onChange={() => setP({ ...p, defaultAddress: a.id })} />Default</label>
                  <button type="button" onClick={() => setP({ ...p, addresses: p.addresses.filter((x) => x.id !== a.id), defaultAddress: p.defaultAddress === a.id ? null : p.defaultAddress })} aria-label="Remove address" className="ml-auto h-8 w-8 grid place-items-center rounded-full text-muted hover:text-down"><Trash2 size={15} /></button>
                </div>
                <input className={`${input} col-span-2`} placeholder="Recipient name" aria-label="Recipient name" value={a.name} onChange={(e) => setAddr(a.id, { name: e.target.value })} />
                <input className={`${input} col-span-2`} placeholder="Street address" aria-label="Street address" value={a.line1} onChange={(e) => setAddr(a.id, { line1: e.target.value })} autoComplete="address-line1" />
                <input className={`${input} col-span-2`} placeholder="Apt, suite (optional)" aria-label="Address line 2" value={a.line2 ?? ""} onChange={(e) => setAddr(a.id, { line2: e.target.value })} autoComplete="address-line2" />
                <input className={input} placeholder="City" aria-label="City" value={a.city} onChange={(e) => setAddr(a.id, { city: e.target.value })} />
                <input className={input} placeholder="State / region" aria-label="State" value={a.region ?? ""} onChange={(e) => setAddr(a.id, { region: e.target.value })} />
                <input className={input} placeholder="Postal code" aria-label="Postal code" value={a.postal} onChange={(e) => setAddr(a.id, { postal: e.target.value })} />
                <input className={input} placeholder="Country (US)" aria-label="Country" maxLength={2} value={a.country} onChange={(e) => setAddr(a.id, { country: e.target.value.toUpperCase() })} />
              </div>
            ))}
            <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" checked={p.billingSameAsShipping} onChange={(e) => setP({ ...p, billingSameAsShipping: e.target.checked })} />Billing address same as shipping</label>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="flex-1 h-12 rounded-full btn-ink font-medium disabled:opacity-50" data-testid="save-profile">{saving ? "Saving…" : "Save profile"}</button>
            <button type="button" onClick={wipe} className="h-12 px-4 rounded-full bg-surface-2 text-[13px] text-down">Delete</button>
          </div>
        </section>
      )}

      <section className="mt-8" data-testid="store-accounts">
        <h2 className="text-[13px] uppercase tracking-wider text-faint mb-1">Store accounts</h2>
        <p className="text-[12.5px] text-muted mb-3">Let your agents sign in to stores with the store&apos;s official sign-in page. Bajar never asks for or stores your store password, and you can disconnect any time.</p>
        <div className="space-y-2">
          {(stores?.connectors ?? []).map((c) => {
            const acct = stores?.accounts.find((a) => a.store === c.id);
            return (
              <div key={c.id} className="rounded-2xl bg-surface p-4" data-testid={`store-${c.id}`}>
                <div className="flex items-center gap-2">
                  <Store size={16} className="text-muted" />
                  <span className="font-medium">{c.name}</span>
                  {acct && <span className="inline-flex items-center gap-1 text-[12px] text-up"><Check size={13} />Connected{acct.accountName ? ` · ${acct.accountName}` : ""}</span>}
                  <span className="ml-auto">
                    {acct ? <button type="button" onClick={() => disconnect(c.id)} className="h-9 px-3 rounded-full bg-surface-2 text-[13px]">Disconnect</button>
                      : !c.configured ? <span className="text-[12px] text-faint" data-testid={`store-${c.id}-unavailable`}>Not set up yet</span>
                      : !signedIn ? <span className="text-[12px] text-faint">Sign in first</span>
                      : <a href={`/api/stores/connect/${c.id}`} className="h-9 px-3 rounded-full btn-ink text-[13px] font-medium inline-flex items-center" data-testid={`connect-${c.id}`}>Sign in with {c.name}</a>}
                  </span>
                </div>
                <ul className="mt-2 text-[12.5px] text-muted list-disc pl-5">{c.grants.map((g) => <li key={g}>{g}</li>)}</ul>
                {!c.configured && <div className="mt-1 text-[11.5px] text-faint">Needs {c.missing.join(", ")} on the server.</div>}
              </div>
            );
          })}
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[12px] text-faint"><ShieldCheck size={13} className="shrink-0 mt-0.5" />Agents can fill in your details and recognize your store accounts, but every payment still needs your own approval.</p>
      </section>
    </div>
  );
}

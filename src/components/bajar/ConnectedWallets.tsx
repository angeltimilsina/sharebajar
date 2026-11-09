"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { BadgeCheck, Check, Copy, KeyRound, Link2, Loader2, ShieldCheck, Trash2, X } from "lucide-react";
import { Button, Card, CardHeader, Notice } from "../ui/primitives";
import { ChainIcon } from "../ui/ChainIcon";
import { bajar } from "@/lib/bajar/session";
import { hybridSignIn } from "@/lib/bajar/auth";
import { useProfile } from "@/hooks/useProfile";
import { shortAddress } from "@/lib/format";

/**
 * Other wallets brought into Bajar Wallet. Bajar Wallet creates a one-time
 * connection token; the other wallet opens the link (on this device or in
 * its own app), signs a message proving control, and joins. Read-only:
 * connected wallets keep their own keys and Bajar can't move their funds.
 */
export function ConnectedWallets() {
  const a = bajar.accounts();
  const p = useProfile();
  const [token, setToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const signedIn = !!a && p.signedIn && p.address === a.solana.address;
  const others = (p.profile?.wallets ?? []).filter((w) => w.address !== a?.solana.address && w.address !== a?.evm.address.toLowerCase());
  const link = token ? `${window.location.origin}/connect/${token.token}` : "";
  const left = token ? Math.max(0, new Date(token.expiresAt).getTime() - now) : 0;

  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 320 }).then(setQr).catch(() => setQr(null)); }, [link]);
  // While a token is open, watch for the other wallet joining.
  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => { void p.refresh(); }, 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  // Close the token panel once a new wallet appears.
  const [seen, setSeen] = useState(others.length);
  useEffect(() => { if (others.length > seen && token) { setToken(null); } setSeen(others.length); }, [others.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (token && left === 0) setToken(null); }, [left, token]);

  const signIn = async () => {
    setBusy(true); setErr(null);
    try { await hybridSignIn(); await p.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/connect/token", { method: "POST" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Couldn't create a token");
      setToken(b); setNow(Date.now());
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (address: string) => {
    const r = await fetch(`/api/profile/wallets?address=${encodeURIComponent(address)}`, { method: "DELETE" }).then((x) => x.json());
    if (!r.ok) setErr(r.error ?? "Couldn't remove"); else await p.refresh();
  };

  return (
    <Card data-testid="connected-wallets">
      <CardHeader title={<span className="inline-flex items-center gap-2"><Link2 size={16} className="text-brand" />Connected wallets</span>} sub="Bring Phantom, MetaMask and others into this Bajar Wallet. Their balances show here; their keys stay in their own app." />
      <div className="px-4 pb-4 space-y-2">
        {!signedIn ? (
          <>
            <p className="text-[13px] text-muted">Sign in once with Bajar Wallet (Ed25519 + ML-DSA-65) to manage connections.</p>
            <Button className="w-full" onClick={signIn} disabled={busy} data-testid="bajar-signin-connections">{busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Sign in with Bajar Wallet</Button>
          </>
        ) : (
          <>
            <ul className="space-y-1.5" data-testid="connected-list">
              {others.map((w) => (
                <li key={w.address} className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2">
                  <ChainIcon chain={w.chainType === "evm" ? "ethereum" : "solana"} size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium truncate flex items-center gap-1">{w.label ?? (w.chainType === "evm" ? "EVM wallet" : "Solana wallet")}<BadgeCheck size={13} className="text-brand shrink-0" /></div>
                    <div className="text-[11.5px] text-muted num">{shortAddress(w.address)}</div>
                  </div>
                  <button onClick={() => remove(w.address)} aria-label={`Disconnect ${w.address}`} className="text-faint hover:text-down"><Trash2 size={14} /></button>
                </li>
              ))}
              {!others.length && <li className="text-[13px] text-muted">No other wallets connected yet.</li>}
            </ul>

            {token ? (
              <div className="rounded-2xl border border-brand/40 bg-brand-soft p-3 space-y-2" data-testid="connect-token">
                <div className="flex items-center gap-2">
                  <KeyRound size={15} className="text-brand" />
                  <span className="text-[14px] font-semibold flex-1">Connection token</span>
                  <span className="text-[12px] text-muted num">{Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}</span>
                  <button onClick={() => setToken(null)} aria-label="Cancel token" className="text-muted hover:text-fg"><X size={15} /></button>
                </div>
                <div className="flex gap-3 items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {qr ? <img src={qr} alt="Connection link QR code" width={112} height={112} className="rounded-lg bg-white p-1 shrink-0" /> : <div className="h-28 w-28 rounded-lg bg-surface-2 shrink-0" />}
                  <ol className="text-[12.5px] text-muted space-y-1 list-decimal pl-4">
                    <li>Open the link in the wallet you want to add — scan it with the wallet app&apos;s browser, or open it here if that wallet is in this browser.</li>
                    <li>Connect that wallet and sign the message. No transaction, no fee.</li>
                  </ol>
                </div>
                <div className="flex gap-2">
                  <input readOnly value={link} aria-label="Connection link" className="no-ring flex-1 min-w-0 h-9 rounded-lg bg-surface px-2 text-[12px] font-mono outline-none" data-testid="connect-link" />
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={13} /> : <Copy size={13} />}</Button>
                  <a href={link} target="_blank" rel="noopener noreferrer"><Button size="sm">Open</Button></a>
                </div>
                <p className="text-[11px] text-faint">Works once and expires in 15 minutes. Anyone with the link can connect a wallet they control to this Bajar Wallet, so only share it with yourself.</p>
              </div>
            ) : (
              <Button className="w-full" onClick={create} disabled={busy || others.length >= (p.pricing?.linkLimit ?? 10)} data-testid="create-connect-token">{busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Create connection token</Button>
            )}
          </>
        )}
        {err && <Notice tone="down">{err}</Notice>}
      </div>
    </Card>
  );
}

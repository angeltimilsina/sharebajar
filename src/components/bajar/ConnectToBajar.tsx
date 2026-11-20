"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Link2, Loader2, Plug, ShieldCheck } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import { Button, Card, Notice } from "../ui/primitives";
import { LogoMark } from "../ui/Logo";
import { shortAddress } from "@/lib/format";

/** Opened from a connection token: connect a wallet here and sign to join a Bajar Wallet. */
export function ConnectToBajar({ token }: { token: string }) {
  const { wallet, openModal, signMessage } = useWallet();
  const [info, setInfo] = useState<{ valid: boolean; bajarAddress?: string; expiresAt?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => { fetch(`/api/connect/token?token=${encodeURIComponent(token)}`).then((r) => r.json()).then(setInfo).catch(() => setInfo({ valid: false })); }, [token]);

  const connect = async () => {
    if (!wallet) return;
    setBusy(true); setErr(null);
    try {
      const s = await fetch("/api/connect/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, address: wallet.address, chainType: wallet.chainType }) }).then((r) => r.json());
      if (!s.message) throw new Error(s.error ?? "Couldn't start");
      const signature = await signMessage(s.message);
      const v = await fetch("/api/connect/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature, label: wallet.walletName }) }).then((r) => r.json());
      if (!v.ok) throw new Error(v.error ?? "Connection failed");
      setDone(true);
    } catch (e) {
      const m = (e as Error).message;
      setErr(/reject|denied|cancel/i.test(m) ? "You cancelled the signature. Nothing was connected." : m);
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-md py-6" data-testid="connect-page">
      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <div>
            <h1 className="text-[22px] leading-tight">Connect to Bajar Wallet</h1>
            <p className="text-[13px] text-muted">{info?.valid && info.bajarAddress ? <>Joining Bajar Wallet <span className="num">{shortAddress(info.bajarAddress)}</span></> : " "}</p>
          </div>
        </div>
        {info === null && <div className="h-24 skeleton rounded-xl" />}
        {info && !info.valid && !done && <Notice tone="down" title="Token expired or used">Create a new connection token in Bajar Wallet and open its link again.</Notice>}
        {done ? (
          <div className="text-center space-y-2" data-testid="connect-done">
            <CheckCircle2 className="mx-auto text-up" size={36} />
            <p className="font-semibold">{wallet ? `${wallet.walletName} ${shortAddress(wallet.address)}` : "Wallet"} is connected</p>
            <p className="text-[13px] text-muted">Its balances now show in Bajar Wallet and Portfolio. You can close this page.</p>
            <Link href="/portfolio"><Button variant="outline">Open Portfolio</Button></Link>
          </div>
        ) : info?.valid && (
          <>
            <ol className="space-y-2 text-[14px]">
              <li className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
                <span className="h-6 w-6 rounded-full bg-brand-fill text-brand-ink grid place-items-center text-[12px] font-semibold">1</span>
                <span className="flex-1">{wallet ? <>Connected: <b>{wallet.walletName}</b> <span className="num text-muted">{shortAddress(wallet.address)}</span></> : "Connect the wallet you want to add"}</span>
                <Button size="sm" variant="outline" onClick={openModal}><Plug size={13} /> {wallet ? "Change" : "Connect"}</Button>
              </li>
              <li className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
                <span className="h-6 w-6 rounded-full bg-brand-fill text-brand-ink grid place-items-center text-[12px] font-semibold">2</span>
                <span className="flex-1">Sign a message to prove it&apos;s yours</span>
              </li>
            </ol>
            <Button className="w-full h-11" disabled={!wallet || busy} onClick={connect} data-testid="connect-sign">{busy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} Connect to Bajar Wallet</Button>
            <p className="text-[11.5px] text-faint flex gap-1.5"><ShieldCheck size={13} className="shrink-0 text-accent" /> Signing a message costs nothing and can&apos;t move funds. The wallet keeps its own keys; Bajar Wallet only reads its balances.</p>
          </>
        )}
        {err && <Notice tone="down">{err}</Notice>}
      </Card>
    </div>
  );
}

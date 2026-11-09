"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeftRight, ExternalLink, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import type { WalletBalance, WalletHolding } from "@/hooks/useWallets";
import type { TrackedWallet, WalletMap } from "@/lib/wallets/registry";
import { shortAddr } from "@/lib/wallets/registry";
import { buildSolanaTransfer, evmTransferTx, toBaseUnits } from "@/lib/wallets/transfer";
import { inspectSolanaTx } from "@/lib/wallet/txguard";
import { solanaSignAndSend } from "@/lib/wallet/solana";
import { linkSignTransaction, linkWalletOf } from "@/lib/wallet/solanaLink";
import { addActivity } from "@/lib/activity";
import { getChain } from "@/lib/chains";
import { formatNumber, formatUsd } from "@/lib/format";
import { useWallet } from "../wallet/WalletProvider";
import { useBajar } from "../bajar/useBajar";
import { Button, Card, CardHeader, Notice } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import type { Eip1193 } from "@/lib/wallet/evm";
import type { InjectedSolana } from "@/lib/wallet/solana";

interface Risk { flags: { severity: "info" | "warn" | "danger"; message: string }[] }
const NATIVE_RESERVE: Record<string, number> = { solana: 0.003 };
const hex = (n: number) => `0x${n.toString(16)}`;

/**
 * Move assets between your own wallets. The sender must be able to sign now
 * (the connected wallet, or the unlocked Bajar Wallet). Each transfer is a
 * plain transfer built in this browser, the recipient is screened, and the
 * sending wallet asks you to approve it.
 */
export function CrossWalletTransfer({ wallets, balances, maps }: { wallets: TrackedWallet[]; balances: WalletBalance[]; maps: WalletMap[] }) {
  const { wallet, solana, evm, openModal } = useWallet();
  const { unlocked } = useBajar();
  const [mapId, setMapId] = useState<string | null>(null);
  useEffect(() => { setMapId(new URLSearchParams(window.location.search).get("map")); }, []);
  const map = maps.find((m) => m.id === mapId) ?? null;
  const scope = map ? wallets.filter((w) => map.walletIds.includes(w.id)) : wallets;

  const canSign = (w: TrackedWallet) => w.chain !== "bitcoin" && (w.source === "bajar" ? unlocked : !!wallet && wallet.address.toLowerCase() === w.address.toLowerCase());
  const senders = scope.filter(canSign);
  const [fromId, setFromId] = useState("");
  const from = senders.find((w) => w.id === fromId) ?? senders[0] ?? null;
  const recipients = scope.filter((w) => from && w.chain === from.chain && w.id !== from.id);
  const [toId, setToId] = useState("");
  const to = recipients.find((w) => w.id === toId) ?? recipients[0] ?? null;
  const holdings: (WalletHolding & { decimals?: number; amountRaw?: string })[] = useMemo(() => (balances.find((b) => b.wallet.id === from?.id)?.holdings ?? []) as never, [balances, from?.id]);
  const [hKey, setHKey] = useState("");
  const h = holdings.find((x) => `${x.network}:${x.token}` === hKey) ?? holdings[0] ?? null;
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState(false);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [step, setStep] = useState<"idle" | "checking" | "signing" | "done" | "failed">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const decimals = h?.decimals ?? (h?.network === "solana" ? 9 : 18);
  const base = h ? toBaseUnits(amount, decimals) : null;
  const tooMuch = !!h && !!base && Number(amount) > h.amount;
  const network = h?.network ?? (from?.chain === "solana" ? "solana" : "ethereum");
  const summary = h && from && to ? `Moved ${amount} ${h.symbol} · ${from.label} → ${to.label}` : "";

  const openReview = async () => {
    if (!to) return;
    setReview(true); setStep("checking"); setErr(null); setHash(null); setRisk(null);
    try {
      const r = await fetch(`/api/wallet/check-address?network=${network}&address=${encodeURIComponent(to.address)}`).then((x) => x.json());
      setRisk({ flags: r.flags ?? [] });
    } catch { setRisk({ flags: [{ severity: "warn", message: "Recipient check unavailable right now." }] }); }
    setStep("idle");
  };
  const blocked = !!risk?.flags.some((f) => f.severity === "danger");

  const execute = async () => {
    if (!from || !to || !h || !base) return;
    setStep("signing"); setErr(null);
    try {
      let txHash: string;
      if (from.chain === "solana") {
        const b64 = await buildSolanaTransfer({ from: from.address, to: to.address, mint: h.token, amount: base, decimals });
        const i = await inspectSolanaTx(b64);
        if (i.feePayer !== from.address || i.risks.length) throw new Error("Blocked: the transfer didn't build as expected.");
        const lw = from.source === "connected" ? linkWalletOf(wallet?.walletId) : null;
        if (lw) { linkSignTransaction(lw, b64, { kind: "send", summary, chain: "solana" }); return; }
        const p = (from.source === "bajar" ? window.bajar?.solana : solana()) as InjectedSolana | undefined;
        if (!p) throw new Error("The sending wallet isn't available. Reconnect it and try again.");
        txHash = await solanaSignAndSend(p, b64);
      } else {
        const c = getChain(network);
        if (!c?.evmChainId) throw new Error("Unsupported network.");
        const p = (from.source === "bajar" ? window.bajar?.evm : evm()) as Eip1193 | undefined;
        if (!p) throw new Error("The sending wallet isn't available. Reconnect it and try again.");
        const current = Number(await p.request({ method: "eth_chainId" }));
        if (current !== c.evmChainId) await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(c.evmChainId) }] });
        txHash = (await p.request({ method: "eth_sendTransaction", params: [evmTransferTx({ from: from.address, to: to.address, token: h.token, amount: base })] })) as string;
      }
      setHash(txHash);
      addActivity({ chain: network, hash: txHash, kind: "send", summary, wallet: from.address });
      setStep("done"); setAmount("");
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      setStep("failed"); setErr(/reject|denied|cancel/i.test(m) ? "Rejected in your wallet. Nothing was sent." : m);
    }
  };

  const select = "no-ring w-full h-11 rounded-xl bg-surface-2 px-3 text-[16px] sm:text-sm outline-none";
  return (
    <Card data-testid="cross-transfer">
      <CardHeader title={<span className="inline-flex items-center gap-2"><ArrowLeftRight size={17} className="text-brand" />Move between wallets</span>} sub={map ? `Within “${map.name}”` : "Between any of your wallets on the same network"} />
      <div className="px-4 sm:px-5 pb-5 space-y-3">
        {maps.length > 0 && (
          <select className={select} value={mapId ?? ""} onChange={(e) => setMapId(e.target.value || null)} aria-label="Limit to map">
            <option value="">All wallets</option>
            {maps.map((m) => <option key={m.id} value={m.id}>Map: {m.name}</option>)}
          </select>
        )}
        {!senders.length ? (
          <Notice title="Connect the wallet you want to send from">
            Transfers are signed by the sending wallet. Connect it (or unlock the <Link href="/wallet" className="underline">Bajar Wallet</Link>) and it will appear here.{" "}
            <button className="underline" onClick={openModal}>Connect wallet</button>
          </Notice>
        ) : (
          <>
            <label className="block text-[12px] text-muted">From
              <select className={select} value={from?.id ?? ""} onChange={(e) => { setFromId(e.target.value); setHKey(""); setAmount(""); }} aria-label="From wallet" data-testid="move-from">
                {senders.map((w) => <option key={w.id} value={w.id}>{w.label} · {shortAddr(w.address)}</option>)}
              </select>
            </label>
            <div className="flex justify-center -my-1"><ArrowDown size={16} className="text-faint" /></div>
            <label className="block text-[12px] text-muted">To
              {recipients.length ? (
                <select className={select} value={to?.id ?? ""} onChange={(e) => setToId(e.target.value)} aria-label="To wallet" data-testid="move-to">
                  {recipients.map((w) => <option key={w.id} value={w.id}>{w.label} · {shortAddr(w.address)}{w.source === "watch" ? " (watch-only)" : ""}</option>)}
                </select>
              ) : <div className="text-[13px] text-muted mt-1">No other {from?.chain === "solana" ? "Solana" : "EVM"} wallet {map ? "in this map" : "yet"} — add one above.</div>}
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <label className="block text-[12px] text-muted">Asset
                <select className={select} value={h ? `${h.network}:${h.token}` : ""} onChange={(e) => { setHKey(e.target.value); setAmount(""); }} aria-label="Asset" data-testid="move-asset">
                  {holdings.map((x) => <option key={`${x.network}:${x.token}`} value={`${x.network}:${x.token}`}>{x.symbol} · {x.networkName} — {formatNumber(x.amount, 6)}</option>)}
                  {!holdings.length && <option value="">No balances</option>}
                </select>
              </label>
              <label className="block text-[12px] text-muted w-[140px]">Amount
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" aria-label="Amount to move" className={`${select} num`} data-testid="move-amount" />
              </label>
            </div>
            {h && (
              <div className="flex justify-between text-[12px] text-muted">
                <span>Balance {formatNumber(h.amount, 6)} {h.symbol}{h.usdValue !== null ? ` · ${formatUsd(h.usdValue)}` : ""}</span>
                <button className="text-brand" onClick={() => setAmount(String(Math.max(0, h.amount - (h.native ? NATIVE_RESERVE[h.network] ?? 0.0005 : 0))).slice(0, 20))}>Max</button>
              </div>
            )}
            {tooMuch && <p className="text-[12px] text-down">More than this wallet holds.</p>}
            <Button size="lg" className="w-full" disabled={!to || !h || !base || tooMuch} onClick={openReview} data-testid="move-review">Review transfer</Button>
          </>
        )}
      </div>

      <Modal open={review} onClose={() => step !== "signing" && setReview(false)} title="Review transfer">
        <div className="px-5 pb-5 space-y-3" data-testid="move-modal">
          {from && to && h && (
            <dl className="rounded-xl bg-surface-2 divide-y divide-line text-[13.5px]">
              {[["From", `${from.label} · ${shortAddr(from.address)}`], ["To", `${to.label} · ${shortAddr(to.address)}`], ["Amount", `${amount} ${h.symbol}`], ["Network", h.networkName], ["Network fee", "Shown by your wallet before you approve"]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 px-3 py-2.5"><dt className="text-muted">{k}</dt><dd className="text-right num">{v}</dd></div>
              ))}
            </dl>
          )}
          {step === "checking" && <div className="text-[13px] text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Checking recipient…</div>}
          {risk && !risk.flags.length && <p className="text-[12.5px] text-up flex items-center gap-1.5"><ShieldCheck size={14} /> Recipient check passed.</p>}
          {risk?.flags.map((f, i) => <Notice key={i} tone={f.severity === "danger" ? "down" : f.severity === "warn" ? "warn" : "info"}><span className="inline-flex gap-1.5"><ShieldAlert size={14} className="shrink-0 mt-0.5" />{f.message}</span></Notice>)}
          {to?.source === "watch" && <Notice tone="warn">The recipient is a watch-only address. Make sure you control it — transfers can&apos;t be reversed.</Notice>}
          {err && <Notice tone="down">{err}</Notice>}
          {step === "done" && hash && (
            <Notice title="Transfer submitted">Tracking it in <Link href="/portfolio" className="underline">Portfolio</Link>. <a className="underline inline-flex items-center gap-1" href={`${getChain(network)?.explorer.tx ?? ""}${hash}`} target="_blank" rel="noopener noreferrer">Explorer <ExternalLink size={11} /></a></Notice>
          )}
          {step !== "done" && (
            <Button size="lg" className="w-full" disabled={step !== "idle" && step !== "failed" || blocked} onClick={execute} data-testid="move-confirm">
              {step === "signing" ? <><Loader2 size={16} className="animate-spin" /> Approve in your wallet…</> : blocked ? "Blocked: risky recipient" : "Approve in wallet"}
            </Button>
          )}
          <p className="text-[11px] text-faint">A plain transfer built in your browser. Your wallet shows the exact transaction and fee before you approve; transfers can&apos;t be reversed.</p>
        </div>
      </Modal>
    </Card>
  );
}

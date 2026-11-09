"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownUp, Check, ExternalLink, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import type { WalletBalance, WalletHolding } from "@/hooks/useWallets";
import type { TrackedWallet } from "@/lib/wallets/registry";
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
import { Button, Notice } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import { ChainIcon } from "../ui/ChainIcon";
import { TokenIcon } from "../ui/TokenIcon";
import type { Eip1193 } from "@/lib/wallet/evm";
import type { InjectedSolana } from "@/lib/wallet/solana";

interface Risk { flags: { severity: "info" | "warn" | "danger"; message: string }[] }
type Holding = WalletHolding & { decimals?: number };
const CHAIN_ICON: Record<string, string> = { solana: "solana", evm: "ethereum", bitcoin: "bitcoin" };
const NATIVE_RESERVE: Record<string, number> = { solana: 0.003 };
const hex = (n: number) => `0x${n.toString(16)}`;

/** Tap-to-select wallet card. */
function WalletCard({ w, value, selected, onClick, testid, note }: { w: TrackedWallet; value: number | null | undefined; selected: boolean; onClick: () => void; testid?: string; note?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} data-testid={testid}
      className={clsx("shrink-0 min-w-[156px] text-left rounded-2xl px-3.5 py-3 transition-all active:scale-[0.98]", selected ? "bg-brand-soft ring-2 ring-brand" : "bg-surface-2 hover:bg-surface-3")}>
      <span className="flex items-center gap-2 text-[13px] font-semibold">
        <ChainIcon chain={CHAIN_ICON[w.chain]} size={15} /><span className="truncate max-w-[104px]">{w.label}</span>
        {selected && <Check size={13} className="ml-auto text-brand shrink-0" />}
      </span>
      <span className="block text-[16px] font-semibold num mt-1">{value === undefined || value === null ? "—" : formatUsd(value)}</span>
      <span className="block text-[11px] text-faint num">{shortAddr(w.address)}{note ? ` · ${note}` : ""}</span>
    </button>
  );
}

/**
 * Move assets between your own wallets. The sender must be able to sign now
 * (the connected wallet, or the unlocked Bajar Wallet). Each transfer is a
 * plain transfer built in this browser, the recipient is screened, and the
 * sending wallet asks you to approve it.
 */
export function CrossWalletTransfer({ wallets, balances, className }: { wallets: TrackedWallet[]; balances: WalletBalance[]; className?: string }) {
  const { wallet, solana, evm, openModal } = useWallet();
  const { unlocked } = useBajar();
  const value = (id: string) => balances.find((b) => b.wallet.id === id)?.totalUsd;

  const canSign = (w: TrackedWallet) => w.chain !== "bitcoin" && (w.source === "bajar" ? unlocked : !!wallet && wallet.address.toLowerCase() === w.address.toLowerCase());
  const senders = wallets.filter(canSign);
  const [fromId, setFromId] = useState("");
  const from = senders.find((w) => w.id === fromId) ?? senders[0] ?? null;
  const recipients = wallets.filter((w) => from && w.chain === from.chain && w.id !== from.id);
  const [toId, setToId] = useState("");
  const to = recipients.find((w) => w.id === toId) ?? recipients[0] ?? null;
  const holdings: Holding[] = useMemo(() => (balances.find((b) => b.wallet.id === from?.id)?.holdings ?? []) as Holding[], [balances, from?.id]);
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
  const usd = h?.usdPrice && Number(amount) ? h.usdPrice * Number(amount) : null;
  const network = h?.network ?? (from?.chain === "solana" ? "solana" : "ethereum");
  const summary = h && from && to ? `Moved ${amount} ${h.symbol} · ${from.label} → ${to.label}` : "";
  const setPct = (p: number) => {
    if (!h) return;
    const max = Math.max(0, h.amount - (p === 1 && h.native ? NATIVE_RESERVE[h.network] ?? 0.0005 : 0));
    setAmount(String(Number((max * p).toFixed(Math.min(decimals, 8)))));
  };
  const flip = () => { if (to && canSign(to) && from) { setFromId(to.id); setToId(from.id); setHKey(""); setAmount(""); } };

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

  return (
    <div className={clsx("space-y-4", className)} data-testid="cross-transfer">
      {!senders.length ? (
        <Notice title="Connect the wallet you want to send from">
          Transfers are signed by the sending wallet. Connect it (or unlock the <Link href="/wallet" className="underline">Bajar Wallet</Link>) and it will appear here.{" "}
          <button className="underline" onClick={openModal}>Connect wallet</button>
        </Notice>
      ) : (
        <>
          <div>
            <div className="text-[12px] font-medium text-muted mb-2">From</div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-1" role="radiogroup" aria-label="From wallet">
              {senders.map((w) => <WalletCard key={w.id} w={w} value={value(w.id)} selected={from?.id === w.id} onClick={() => { setFromId(w.id); setHKey(""); setAmount(""); }} testid="move-from-card" />)}
            </div>
          </div>
          <div className="flex justify-center -my-2">
            <button type="button" onClick={flip} disabled={!to || !canSign(to)} aria-label="Swap direction" className="h-9 w-9 rounded-full bg-surface-3 grid place-items-center disabled:opacity-40"><ArrowDownUp size={16} /></button>
          </div>
          <div>
            <div className="text-[12px] font-medium text-muted mb-2">To</div>
            {recipients.length ? (
              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-1" role="radiogroup" aria-label="To wallet">
                {recipients.map((w) => <WalletCard key={w.id} w={w} value={value(w.id)} selected={to?.id === w.id} onClick={() => setToId(w.id)} testid="move-to-card" note={w.source === "watch" ? "watch-only" : undefined} />)}
              </div>
            ) : <p className="text-[13.5px] text-muted">No other {from?.chain === "solana" ? "Solana" : "EVM"} wallet yet. <Link href="/wallets#add" className="text-brand">Add one</Link></p>}
          </div>
          <div>
            <div className="text-[12px] font-medium text-muted mb-2">Asset</div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-1" role="radiogroup" aria-label="Asset" data-testid="move-assets">
              {holdings.length ? holdings.map((x) => {
                const k = `${x.network}:${x.token}`, on = h && `${h.network}:${h.token}` === k;
                return (
                  <button key={k} type="button" onClick={() => { setHKey(k); setAmount(""); }} aria-pressed={!!on}
                    className={clsx("shrink-0 flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1.5 text-[13px] transition-colors", on ? "bg-brand-soft ring-2 ring-brand" : "bg-surface-2 hover:bg-surface-3")}>
                    <TokenIcon symbol={x.symbol} size={22} canonical /><span className="font-semibold">{x.symbol}</span><span className="text-muted num">{formatNumber(x.amount, 4)}</span>
                  </button>
                );
              }) : <span className="text-[13px] text-muted">No balances in this wallet</span>}
            </div>
          </div>
          {h && (
            <div className="rounded-2xl bg-surface-2 p-4">
              <div className="flex items-baseline gap-2">
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" aria-label="Amount to move" data-testid="move-amount"
                  className="no-ring min-w-0 flex-1 bg-transparent outline-none text-[32px] font-semibold num" />
                <span className="text-[17px] font-semibold text-muted">{h.symbol}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 mt-1 text-[12.5px] text-muted">
                <span className="num">{usd !== null ? `≈ ${formatUsd(usd)} · ` : ""}Balance {formatNumber(h.amount, 6)} {h.symbol}</span>
                <span className="flex gap-1.5">
                  {[0.25, 0.5, 0.75, 1].map((p) => <button key={p} type="button" onClick={() => setPct(p)} className="rounded-full bg-surface px-2.5 py-1 font-medium hover:text-fg">{p === 1 ? "Max" : `${p * 100}%`}</button>)}
                </span>
              </div>
              {tooMuch && <p className="text-[12px] text-down mt-1">More than this wallet holds.</p>}
            </div>
          )}
          <Button size="lg" className="w-full" disabled={!to || !h || !base || tooMuch} onClick={openReview} data-testid="move-review">Review transfer</Button>
        </>
      )}

      <Modal open={review} onClose={() => step !== "signing" && setReview(false)} title="Review transfer">
        <div className="px-5 pb-5 space-y-3" data-testid="move-modal">
          {from && to && h && (
            <dl className="rounded-xl bg-surface-2 divide-y divide-line text-[13.5px]">
              {[["From", `${from.label} · ${shortAddr(from.address)}`], ["To", `${to.label} · ${shortAddr(to.address)}`], ["Amount", `${amount} ${h.symbol}${usd !== null ? ` (≈ ${formatUsd(usd)})` : ""}`], ["Network", h.networkName], ["Network fee", "Shown by your wallet before you approve"], ["Bajar fee", "None on transfers"]].map(([k, v]) => (
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
            <Button size="lg" className="w-full" disabled={(step !== "idle" && step !== "failed") || blocked} onClick={execute} data-testid="move-confirm">
              {step === "signing" ? <><Loader2 size={16} className="animate-spin" /> Approve in your wallet…</> : blocked ? "Blocked: risky recipient" : "Approve in wallet"}
            </Button>
          )}
          <p className="text-[11px] text-faint">A plain transfer built in your browser. Your wallet shows the exact transaction and fee before you approve; transfers can&apos;t be reversed.</p>
        </div>
      </Modal>
    </div>
  );
}

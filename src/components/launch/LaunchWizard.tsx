"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import bs58 from "bs58";
import { Check, ChevronLeft, ChevronRight, Info, Rocket } from "lucide-react";
import { Button, Notice } from "../ui/primitives";
import { ChainIcon } from "../ui/ChainIcon";
import { TokenLauncher, type LaunchPreset } from "../discover/TokenLauncher";
import { EvmTokenLauncher } from "../discover/EvmTokenLauncher";
import { EVM_LAUNCH_CHAINS } from "@/lib/launch/evmToken";
import { CreatePool } from "./CreatePool";

const NETS = [
  { id: "solana", name: "Solana", wallet: "Solana wallet", note: "SPL token + Metaplex metadata" },
  { id: "ethereum", name: "Ethereum", wallet: "EVM wallet", note: "ERC-20 (BajarToken)" },
  { id: "base", name: "Base", wallet: "EVM wallet", note: "ERC-20 (BajarToken)" },
  { id: "bsc", name: "BNB Chain", wallet: "EVM wallet", note: "BEP-20 (BajarToken)" },
] as const;
type NetId = (typeof NETS)[number]["id"];

interface Plan { schedule: number[]; totalUsd: number; chargedUsd: number; networks: { network: NetId; feeUsd: number; recipient: string | null; token: string; amountRaw: string; display: string }[] }

const input = "w-full h-11 rounded-xl border border-line bg-surface-2 px-3 text-[16px] sm:text-sm outline-none focus:border-line-strong";
const https = (u: string) => !u || /^https:\/\/\S+$/.test(u);

/**
 * One token, several networks. Fill the details once, pick networks (the fee
 * grows with how many), then launch on each in turn — every network is
 * simulated and signed by your own wallet. Each network gets its own token
 * with the same name, symbol and supply (not bridged).
 */
export function LaunchWizard() {
  const [step, setStep] = useState<"details" | "networks" | "launch">("details");
  const [d, setD] = useState<LaunchPreset>({ name: "", symbol: "", supply: "1000000000", decimals: "6", description: "", image: "", website: "", twitter: "", telegram: "", revokeMint: true, revokeFreeze: true, immutable: false });
  const [nets, setNets] = useState<NetId[]>(["solana"]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [groupKey, setGroupKey] = useState("");
  const [live, setLive] = useState<Partial<Record<NetId, string>>>({});
  const [active, setActive] = useState<NetId | null>(null);
  const set = (k: keyof LaunchPreset) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setD((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    if (!nets.length) { setPlan(null); return; }
    let alive = true;
    fetch(`/api/launch/config?networks=${nets.join(",")}`).then((r) => r.json()).then((p) => { if (alive) setPlan(p); }).catch(() => {});
    return () => { alive = false; };
  }, [nets.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasSol = nets.includes("solana");
  const errors = useMemo(() => {
    const e: string[] = [];
    const nameMax = hasSol ? 32 : 64;
    if (!d.name.trim() || new TextEncoder().encode(d.name).length > nameMax) e.push(`Name: 1–${nameMax} characters.`);
    if (!new RegExp(`^[A-Z0-9$._-]{1,${hasSol ? 10 : 16}}$`).test(d.symbol)) e.push(`Symbol: 1–${hasSol ? 10 : 16} letters or digits.`);
    if (!/^\d{1,18}$/.test(d.supply) || BigInt(d.supply) <= BigInt(0)) e.push("Supply must be a whole number above zero.");
    if (hasSol && BigInt(d.supply || "0") * BigInt(10) ** BigInt(Number(d.decimals)) > BigInt("18446744073709551615")) e.push("Supply × 10^decimals is too large for Solana. Lower the supply or decimals.");
    if (![d.image, d.website, d.twitter, d.telegram].every(https)) e.push("Links must start with https://");
    return e;
  }, [d, hasSol]);

  const start = () => {
    setGroupKey(bs58.encode(crypto.getRandomValues(new Uint8Array(24))));
    setLive({});
    setActive(nets[0]);
    setStep("launch");
  };
  const onLaunched = (n: NetId) => (token: string) => {
    setLive((l) => ({ ...l, [n]: token }));
  };
  const next = NETS.map((n) => n.id).filter((n) => nets.includes(n)).find((n) => !live[n]) ?? null;
  const firstLive = (Object.entries(live) as [NetId, string][])[0];
  const feeOf = (n: NetId) => plan?.networks.find((x) => x.network === n);

  return (
    <div className="space-y-4" data-testid="launch-wizard">
      {/* Steps */}
      <ol className="grid grid-cols-3 gap-1 text-[12px]">
        {(["details", "networks", "launch"] as const).map((s, i) => (
          <li key={s} className={clsx("rounded-full px-2 py-1.5 text-center font-medium", step === s ? "bg-brand-fill text-brand-ink" : "bg-surface-2 text-muted")}>{i + 1}. {s === "details" ? "Details" : s === "networks" ? "Networks & fees" : "Launch"}</li>
        ))}
      </ol>

      {step === "details" && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <input className={input} placeholder="Token name" maxLength={64} value={d.name} onChange={set("name")} aria-label="Token name" />
            <input className={input} placeholder="Symbol" maxLength={16} value={d.symbol} onChange={(e) => setD((s) => ({ ...s, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9$._-]/g, "") }))} aria-label="Symbol" />
          </div>
          <div className="grid grid-cols-[1fr_130px] gap-2">
            <input className={input} inputMode="numeric" placeholder="Total supply" value={d.supply} onChange={(e) => setD((s) => ({ ...s, supply: e.target.value.replace(/\D/g, "") }))} aria-label="Total supply" />
            <select className={input} value={d.decimals} onChange={set("decimals")} aria-label="Decimals (Solana)">{[0, 2, 4, 6, 8, 9].map((x) => <option key={x} value={x}>{x} dec (SOL)</option>)}</select>
          </div>
          <input className={input} placeholder="Logo image URL — https://…" value={d.image} onChange={set("image")} aria-label="Logo image URL" />
          <textarea className={clsx(input, "h-20 py-2")} maxLength={600} placeholder="Description" value={d.description} onChange={set("description")} aria-label="Description" />
          <div className="grid sm:grid-cols-3 gap-2">
            <input className={input} placeholder="Website" value={d.website} onChange={set("website")} aria-label="Website" />
            <input className={input} placeholder="X / Twitter URL" value={d.twitter} onChange={set("twitter")} aria-label="Twitter" />
            <input className={input} placeholder="Telegram URL" value={d.telegram} onChange={set("telegram")} aria-label="Telegram" />
          </div>
          <details className="rounded-xl border border-line text-sm">
            <summary className="px-3 py-2.5 cursor-pointer font-medium">Solana options</summary>
            {([["revokeMint", "Fixed supply", "Revoke the mint authority — nobody can mint more."], ["revokeFreeze", "No freeze authority", "Nobody can freeze holders' tokens. Most DEXs require it."], ["immutable", "Lock metadata", "Name, symbol and logo can never change (you can't edit them later)."]] as const).map(([k, label, hint]) => (
              <label key={k} className="flex items-start gap-3 px-3 py-2 border-t border-line cursor-pointer">
                <input type="checkbox" className="mt-1" checked={d[k]} onChange={(e) => setD((s) => ({ ...s, [k]: e.target.checked }))} />
                <span><span className="block font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
              </label>
            ))}
          </details>
          <p className="text-[11.5px] text-faint">On Ethereum, Base and BNB Chain the token always has a fixed supply, no owner and 18 decimals. Logo, description and links can be edited later in the token manager.</p>
          {errors.length > 0 && (d.name || d.symbol) && <p className="text-xs text-down">{errors[0]}</p>}
          <Button className="w-full h-11" disabled={errors.length > 0} onClick={() => setStep("networks")} data-testid="wizard-next">Choose networks <ChevronRight size={15} /></Button>
        </div>
      )}

      {step === "networks" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Networks">
            {NETS.map((n) => {
              const on = nets.includes(n.id);
              return (
                <button key={n.id} role="checkbox" aria-checked={on} data-testid={`net-${n.id}`} onClick={() => setNets((s) => (on ? s.filter((x) => x !== n.id) : [...s, n.id]))}
                  className={clsx("rounded-2xl p-3 text-left border transition-colors", on ? "border-brand bg-brand-soft" : "border-line bg-surface-2 hover:bg-surface-3")}>
                  <div className="flex items-center gap-2"><ChainIcon chain={n.id} size={20} /><span className="font-semibold text-[14px] flex-1">{n.name}</span>{on && <Check size={15} className="text-brand" />}</div>
                  <div className="text-[11.5px] text-muted mt-1">{n.note}</div>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl bg-surface-2 p-3 text-[13px] space-y-1.5" data-testid="fee-plan">
            <div className="flex justify-between font-semibold"><span>Bajar launch fee · {nets.length} network{nets.length === 1 ? "" : "s"}</span><span className="num">{plan ? (plan.chargedUsd ? `${plan.chargedUsd} USDC` : "None") : "…"}</span></div>
            {plan?.networks.map((x) => (
              <div key={x.network} className="flex justify-between text-muted"><span className="inline-flex items-center gap-1.5"><ChainIcon chain={x.network} size={13} />{NETS.find((n) => n.id === x.network)?.name}</span><span className="num">{x.display}</span></div>
            ))}
            {plan && <div className="pt-1.5 border-t border-line text-[11.5px] text-faint">Pricing: {plan.schedule.map((v, i) => `${i + 1} network${i ? "s" : ""} ${v} USDC`).join(" · ")}. Each network pays its share when it launches.{plan.chargedUsd < plan.totalUsd ? " Networks where Bajar's treasury isn't active yet charge nothing." : ""}</div>}
            <div className="text-[11.5px] text-faint">Plus each network&apos;s own costs (gas, rent), shown before you sign.</div>
          </div>

          {nets.length > 1 && <Notice title="One token per network"><span className="text-[12.5px]">Each network gets its own token with the same name, symbol and supply, and the full supply on each goes to your wallet. They aren&apos;t bridged: moving tokens between networks needs a bridge you set up later.</span></Notice>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("details")}><ChevronLeft size={15} /> Back</Button>
            <Button className="flex-1 h-11" disabled={!nets.length || !plan} onClick={start} data-testid="wizard-start"><Rocket size={15} /> Launch on {nets.length} network{nets.length === 1 ? "" : "s"}</Button>
          </div>
        </div>
      )}

      {step === "launch" && (
        <div className="space-y-2.5">
          {NETS.filter((n) => nets.includes(n.id)).map((n) => {
            const token = live[n.id];
            const isActive = !token && (active === n.id || next === n.id);
            const f = feeOf(n.id);
            const evmChain = EVM_LAUNCH_CHAINS.find((c) => c.id === n.id);
            return (
              <div key={n.id} className={clsx("rounded-2xl border", token ? "border-up/40" : isActive ? "border-brand/50" : "border-line")} data-testid={`launch-row-${n.id}`}>
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <ChainIcon chain={n.id} size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold">{n.name}</div>
                    <div className="text-[11.5px] text-muted truncate">{token ? <span className="font-mono">{token}</span> : `${n.wallet} · fee ${f?.display ?? "None"}`}</div>
                  </div>
                  {token ? <span className="inline-flex items-center gap-1 text-up text-[12.5px] font-semibold"><Check size={14} /> Live</span>
                    : !isActive ? <Button size="sm" variant="ghost" onClick={() => setActive(n.id)}>Launch</Button> : null}
                </div>
                {token && (
                  <div className="px-3 pb-3" data-testid={`pool-${n.id}`}>
                    <CreatePool chain={n.id} token={token} symbol={d.symbol} decimals={n.id === "solana" ? Number(d.decimals) : 18} />
                  </div>
                )}
                {isActive && (
                  <div className="px-3 pb-3">
                    {n.id === "solana"
                      ? <TokenLauncher key={`sol-${groupKey}`} preset={d} fee={f?.recipient ? { amountUsdc: f.feeUsd, recipient: f.recipient } : null} groupKey={groupKey} onLaunched={onLaunched("solana")} />
                      : evmChain && <EvmTokenLauncher key={`${n.id}-${groupKey}`} chain={evmChain} preset={{ name: d.name, symbol: d.symbol, supply: d.supply }} fee={f?.recipient ? { recipient: f.recipient, amountWei: f.amountRaw, display: f.display } : null} groupKey={groupKey} onLaunched={onLaunched(n.id)} />}
                  </div>
                )}
              </div>
            );
          })}
          {firstLive && (
            <div className="rounded-2xl bg-surface-2 p-3 flex flex-wrap items-center gap-2" data-testid="wizard-summary">
              <span className="text-[13.5px] flex-1">{d.symbol} is live on {Object.keys(live).length} of {nets.length} network{nets.length === 1 ? "" : "s"}.{next ? " Continue with the next network above." : ""}</span>
              <Link href={`/launchpad/token/${firstLive[0]}/${firstLive[1]}`}><Button data-testid="open-manager">Open token manager</Button></Link>
            </div>
          )}
          <p className="text-[11.5px] text-faint flex gap-1.5"><Info size={13} className="shrink-0" /> Switch wallets between networks when asked (Solana wallet for Solana, an EVM wallet such as MetaMask or Bajar Wallet for the others). Every transaction is simulated and signed by you.</p>
          <Button variant="ghost" size="sm" onClick={() => setStep("networks")} disabled={Object.keys(live).length > 0}><ChevronLeft size={14} /> Change networks</Button>
        </div>
      )}
    </div>
  );
}

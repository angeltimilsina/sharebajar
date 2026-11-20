"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Rocket, Wallet } from "lucide-react";
import { Button, Card, CardHeader, Notice } from "../ui/primitives";
import { ChainIcon } from "../ui/ChainIcon";
import { api, can, type Me } from "./client";
import { bajar } from "@/lib/bajar/session";

interface Data {
  settings: { schedule: number[]; solanaRecipient: string | null; evmRecipient: string | null; updatedBy?: string; updatedAt?: string; fromEnv: boolean };
  preview: { totalUsd: number; chargedUsd: number; networks: { network: string; display: string; recipient: string | null }[] };
}
const NAME: Record<string, string> = { solana: "Solana", ethereum: "Ethereum", base: "Base", bsc: "BNB Chain" };

/** Owner settings for token launch fees: amounts by number of networks and where they're paid. */
export function LaunchFees({ me }: { me: Me }) {
  const [d, setD] = useState<Data | null>(null);
  const [f, setF] = useState({ schedule: "1,2,3,4", solanaRecipient: "", evmRecipient: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  const owner = can(me, "owner");
  const load = useCallback(() => api<Data>("/api/treasury/launch-fees").then((x) => { setD(x); setF({ schedule: x.settings.schedule.join(","), solanaRecipient: x.settings.solanaRecipient ?? "", evmRecipient: x.settings.evmRecipient ?? "" }); }).catch((e) => setMsg({ tone: "down", text: (e as Error).message })), []);
  useEffect(() => { void load(); }, [load]);
  const a = bajar.isUnlocked() ? bajar.accounts() : null;
  const field = "no-ring w-full h-10 rounded-xl bg-surface-2 px-3 text-[16px] sm:text-sm font-mono outline-none";

  const save = async () => {
    setBusy(true); setMsg(null);
    try { await api("/api/treasury/launch-fees", { body: f }); setMsg({ tone: "info", text: "Saved. New launches use these settings." }); await load(); }
    catch (e) { setMsg({ tone: "down", text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]" data-testid="launch-fees">
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><Rocket size={16} className="text-ai" />Token launch fees</span>} sub="Total fee for launching on 1, 2, 3 or 4 networks, split evenly and paid on each network: USDC on Solana, native coin (live price) on EVM. Shown to creators before they sign." />
        <div className="px-4 sm:px-5 pb-5 space-y-3">
          <label className="block text-[12.5px] text-muted">Fee schedule (USDC, totals for 1,2,3,4 networks)
            <input className={field} value={f.schedule} onChange={(e) => setF((x) => ({ ...x, schedule: e.target.value }))} disabled={!owner} aria-label="Fee schedule" />
          </label>
          <label className="block text-[12.5px] text-muted">Solana fee address (receives USDC)
            <input className={field} value={f.solanaRecipient} onChange={(e) => setF((x) => ({ ...x, solanaRecipient: e.target.value.trim() }))} disabled={!owner} placeholder="Solana address" aria-label="Solana fee address" />
          </label>
          <label className="block text-[12.5px] text-muted">EVM fee address (Ethereum, Base, BNB Chain)
            <input className={field} value={f.evmRecipient} onChange={(e) => setF((x) => ({ ...x, evmRecipient: e.target.value.trim() }))} disabled={!owner} placeholder="0x…" aria-label="EVM fee address" />
          </label>
          {owner && a && <Button size="sm" variant="outline" onClick={() => setF((x) => ({ ...x, solanaRecipient: a.solana.address, evmRecipient: a.evm.address }))} data-testid="use-bajar-fee-addresses"><Wallet size={13} /> Use my Bajar Wallet addresses</Button>}
          <p className="text-[11.5px] text-faint">A network&apos;s active, verified treasury (multisig) takes priority over these addresses. Prefer a multisig for fee addresses; changes are audited and raise an alert.</p>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {owner ? <Button className="w-full" onClick={save} disabled={busy} data-testid="launch-fees-save">{busy ? <Loader2 size={15} className="animate-spin" /> : null} Save launch fees</Button> : <p className="text-[12px] text-muted">Only owners can change launch fees.</p>}
          {d?.settings.updatedBy && <p className="text-[11.5px] text-faint">Last changed by {d.settings.updatedBy.slice(0, 6)}…{d.settings.updatedBy.slice(-4)}{d.settings.updatedAt ? ` · ${new Date(d.settings.updatedAt).toLocaleString()}` : ""}</p>}
        </div>
      </Card>
      <Card className="p-4 sm:p-5">
        <h3 className="text-[14px] font-semibold">What a 4-network launch pays now</h3>
        <ul className="mt-2 space-y-1.5 text-[13px]">
          {d?.preview.networks.map((n) => (
            <li key={n.network} className="flex items-center gap-2"><ChainIcon chain={n.network} size={14} /><span className="flex-1">{NAME[n.network] ?? n.network}</span><span className="num">{n.display}</span></li>
          ))}
        </ul>
        <div className="mt-2 pt-2 border-t border-line flex justify-between text-[13px] font-semibold"><span>Charged</span><span className="num">{d ? `${d.preview.chargedUsd} of ${d.preview.totalUsd} USDC` : "…"}</span></div>
        {d && d.preview.chargedUsd < d.preview.totalUsd && <p className="text-[11.5px] text-faint mt-1">Networks without a fee address (or live price) charge nothing.</p>}
      </Card>
    </div>
  );
}

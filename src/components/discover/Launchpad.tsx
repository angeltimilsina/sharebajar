"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Rocket } from "lucide-react";
import { usePoll } from "@/hooks/usePoll";
import { getChain } from "@/lib/chains";
import { timeAgo } from "@/lib/format";
import { TokenIcon } from "../ui/TokenIcon";
import { TokenLauncher } from "./TokenLauncher";
import { EvmTokenLauncher } from "./EvmTokenLauncher";
import { ManageTokens } from "./ManageTokens";
import { EVM_LAUNCH_CHAINS } from "@/lib/launch/evmToken";
import { ChainIcon } from "../ui/ChainIcon";
import clsx from "clsx";

interface Launch { mint: string; chain: string; name: string; symbol: string; creator: string; fixed_supply: boolean; freeze_revoked: boolean; created_at: string }
import type { Pool } from "@/lib/types";
import { Badge, Card, CardHeader, Notice } from "../ui/primitives";
import { DataStatus } from "../ui/DataStatus";
import { NetworkFilter } from "../market/NetworkFilter";
import { PoolTable } from "../market/PoolTable";

export function Launchpad() {
  const sp = useSearchParams();
  const [network, setNetwork] = useState(sp.get("network") ?? "all");
  const chain = getChain(network);
  const pools = usePoll<Pool[]>(`/api/dex/pools?feed=new${chain ? `&network=${chain.id}` : ""}`, 15_000);
  const [launches, setLaunches] = useState<Launch[] | null>(null);
  const [launchChain, setLaunchChain] = useState<string>(["solana", "ethereum", "base", "bsc"].includes(sp.get("chain") ?? "") ? sp.get("chain")! : "solana");
  const [focus, setFocus] = useState<{ chain: string; token: string } | null>(null);
  const manage = (chain: string) => (token: string) => { setFocus({ chain, token }); setTimeout(() => document.getElementById("manage")?.scrollIntoView({ behavior: "smooth" }), 50); };
  const evmChain = EVM_LAUNCH_CHAINS.find((c) => c.id === launchChain);
  useEffect(() => { fetch("/api/launch/record").then((r) => r.json()).then((b) => setLaunches(b.launches ?? [])).catch(() => setLaunches([])); }, []);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_440px]">
        <div className="space-y-4 min-w-0">
          <div className="rounded-[22px] border border-line bg-surface p-6 sm:p-7">
            <div className="flex items-center gap-2 text-ai"><Rocket size={18} /><span className="text-xs font-medium uppercase tracking-wider">Launchpad</span></div>
            <h1 className="mt-2 text-[30px] sm:text-[36px]">Launch a token, then manage it.</h1>
            <p className="text-sm sm:text-[15px] text-muted mt-2 max-w-xl">Create a token on Solana, Ethereum, Base or BNB Chain from your own wallet in one transaction, then manage it: revoke authorities, burn, edit or lock metadata and add liquidity. Follow every new pool across networks as it appears.</p>
            <ul className="mt-4 grid sm:grid-cols-3 gap-2 text-xs">
              {["Your wallet signs; Bajar holds no authority", "Simulated before you sign", "Costs shown up front"].map((t) => <li key={t} className="rounded-xl bg-surface-2 px-3 py-2">{t}</li>)}
            </ul>
          </div>
          <Card>
            <CardHeader title="Launched on Bajar" sub="Verified on-chain after creation" />
            {launches === null ? <div className="px-5 pb-5"><div className="h-16 skeleton" /></div> : launches.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">No launches yet. Yours could be the first.</p>
            ) : (
              <ul className="divide-y divide-line">
                {launches.slice(0, 10).map((l) => (
                  <li key={l.mint}>
                    <Link href={`/token/${l.chain ?? "solana"}/${l.mint}`} className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-surface-2/70">
                      <span className="relative"><TokenIcon symbol={l.symbol} size={28} /><span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[1.5px]"><ChainIcon chain={l.chain ?? "solana"} size={12} /></span></span>
                      <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{l.symbol} <span className="text-muted font-normal">· {l.name}</span></span><span className="block text-[11px] text-muted">{timeAgo(new Date(l.created_at).getTime())}</span></span>
                      {l.fixed_supply && <Badge tone="up">Fixed supply</Badge>}
                      {l.freeze_revoked && <Badge tone="up" className="hidden sm:inline-flex">No freeze</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card id="create" className="p-5 h-fit">
          <h2 className="text-[22px] mb-3">Create a token</h2>
          <div role="radiogroup" aria-label="Launch network" className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1 mb-4" data-testid="launch-chain">
            {[{ id: "solana", name: "Solana" }, ...EVM_LAUNCH_CHAINS.map((c) => ({ id: c.id, name: c.id === "bsc" ? "BNB" : c.name }))].map((c) => (
              <button key={c.id} role="radio" aria-checked={launchChain === c.id} onClick={() => setLaunchChain(c.id)} className={clsx("h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11.5px] font-medium", launchChain === c.id ? "seg-on text-fg" : "text-muted")}>
                <ChainIcon chain={c.id} size={18} />{c.name}
              </button>
            ))}
          </div>
          {evmChain ? <EvmTokenLauncher chain={evmChain} onManage={manage(evmChain.id)} /> : <TokenLauncher onManage={manage("solana")} />}
        </Card>
      </div>
      <ManageTokens focus={focus} />
      <NetworkFilter value={network} onChange={setNetwork} />
      <Card>
        <CardHeader title="Newly created pools" sub={<DataStatus fetchedAt={pools.fetchedAt} expectedMs={15_000} stale={pools.stale} error={pools.error} source="GeckoTerminal" />} />
        <Notice tone="warn" className="mx-4 mb-3">New tokens are extremely high-risk. Many are abandoned or malicious within hours. Check liquidity, holder concentration and contract permissions before trading.</Notice>
        <PoolTable pools={pools.data ?? []} loading={pools.loading} error={pools.error} />
      </Card>
    </div>
  );
}

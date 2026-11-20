"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Rocket } from "lucide-react";
import { usePoll } from "@/hooks/usePoll";
import { getChain } from "@/lib/chains";
import { LaunchWizard } from "../launch/LaunchWizard";
import { ManageTokens } from "./ManageTokens";
import { ChainIcon } from "../ui/ChainIcon";

import type { Pool } from "@/lib/types";
import { Card, CardHeader, Notice } from "../ui/primitives";
import { DataStatus } from "../ui/DataStatus";
import { NetworkFilter } from "../market/NetworkFilter";
import { PoolTable } from "../market/PoolTable";

export function Launchpad() {
  const sp = useSearchParams();
  const [network, setNetwork] = useState(sp.get("network") ?? "all");
  const chain = getChain(network);
  const pools = usePoll<Pool[]>(`/api/dex/pools?feed=new${chain ? `&network=${chain.id}` : ""}`, 15_000);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_440px]">
        <div className="space-y-4 min-w-0">
          <div className="rounded-[22px] border border-line bg-surface p-6 sm:p-7">
            <div className="flex items-center gap-2 text-ai"><Rocket size={18} /><span className="text-xs font-medium uppercase tracking-wider">Launchpad</span></div>
            <h1 className="mt-2 text-[30px] sm:text-[36px]">Launch on every network, manage in one place.</h1>
            <p className="text-sm sm:text-[15px] text-muted mt-2 max-w-xl">Create your token once and launch it on Solana, Ethereum, Base and BNB Chain from your own wallet. Then run it from the token manager: logo, description and links, supply and authorities, pairs and liquidity.</p>
            <ul className="mt-4 grid sm:grid-cols-2 gap-2 text-xs">
              {["Your wallet signs every step; Bajar holds no authority", "Simulated before you sign", "Every cost and fee shown up front", "Fee grows with the number of networks"].map((t) => <li key={t} className="rounded-xl bg-surface-2 px-3 py-2">{t}</li>)}
            </ul>
            <div className="mt-4 flex items-center gap-1.5">{["solana", "ethereum", "base", "bsc"].map((c) => <span key={c} className="h-8 w-8 rounded-full bg-surface-2 grid place-items-center"><ChainIcon chain={c} size={17} /></span>)}</div>
          </div>
        </div>
        <Card id="create" className="p-5 h-fit">
          <h2 className="text-[22px] mb-3">Create a token</h2>
          <LaunchWizard />
        </Card>
      </div>
      <ManageTokens />
      <NetworkFilter value={network} onChange={setNetwork} />
      <Card>
        <CardHeader title="Newly created pools" sub={<DataStatus fetchedAt={pools.fetchedAt} expectedMs={15_000} stale={pools.stale} error={pools.error} source="GeckoTerminal" />} />
        <Notice tone="warn" className="mx-4 mb-3">New tokens are extremely high-risk. Many are abandoned or malicious within hours. Check liquidity, holder concentration and contract permissions before trading.</Notice>
        <PoolTable pools={pools.data ?? []} loading={pools.loading} error={pools.error} />
      </Card>
    </div>
  );
}

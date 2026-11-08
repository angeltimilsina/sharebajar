"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Rocket, Lock } from "lucide-react";
import { usePoll } from "@/hooks/usePoll";
import { getChain, CHAINS } from "@/lib/chains";
import type { Pool } from "@/lib/types";
import { Badge, Button, Card, CardHeader, Notice } from "../ui/primitives";
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
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div className="rounded-2xl border border-ai/25 p-6 relative overflow-hidden" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--ai) 22%, var(--surface)), var(--surface))" }}>
          <Rocket size={120} className="absolute right-6 bottom-2 text-ai opacity-30 -rotate-12" />
          <h1 className="text-2xl font-bold tracking-tight">Launchpad</h1>
          <p className="text-sm text-muted mt-1 max-w-xl">Track every new liquidity pool the moment it appears on-chain, and — soon — launch your own token across multiple networks directly from Bajar.</p>
          <div className="mt-4 flex gap-2 flex-wrap"><Badge tone="up">Live pool feed</Badge><Badge tone="brand">Multi-chain</Badge><Badge tone="ai">Token creation coming soon</Badge></div>
        </div>
        <Card id="create">
          <CardHeader title="Create a token" icon={<Badge tone="ai" className="ml-1">Coming soon</Badge>} />
          <div className="px-4 pb-4 space-y-3">
            <Notice tone="ai">Token creation is <b>not yet available</b>. The form below is a preview of the upcoming flow; nothing is submitted or deployed.</Notice>
            <fieldset disabled className="space-y-2.5 opacity-60">
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Token name" className="h-9 rounded-lg border border-line bg-surface-2 px-2.5 text-sm" />
                <input placeholder="Symbol" className="h-9 rounded-lg border border-line bg-surface-2 px-2.5 text-sm" />
              </div>
              <select className="w-full h-9 rounded-lg border border-line bg-surface-2 px-2.5 text-sm">{CHAINS.slice(0, 6).map((c) => <option key={c.id}>{c.name}</option>)}</select>
              <input placeholder="Total supply" className="w-full h-9 rounded-lg border border-line bg-surface-2 px-2.5 text-sm" />
              <Button className="w-full" disabled><Lock size={14} /> Deploy token (coming soon)</Button>
            </fieldset>
          </div>
        </Card>
      </div>
      <NetworkFilter value={network} onChange={setNetwork} />
      <Card>
        <CardHeader title="Newly created pools" sub={<DataStatus fetchedAt={pools.fetchedAt} expectedMs={15_000} stale={pools.stale} error={pools.error} source="GeckoTerminal" />} />
        <Notice tone="warn" className="mx-4 mb-3">New tokens are extremely high-risk. Many are abandoned or malicious within hours. Check liquidity, holder concentration and contract permissions before trading.</Notice>
        <PoolTable pools={pools.data ?? []} loading={pools.loading} error={pools.error} />
      </Card>
    </div>
  );
}

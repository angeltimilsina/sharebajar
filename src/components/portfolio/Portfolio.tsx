"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ExternalLink, ShieldCheck, Trash2, BellRing } from "lucide-react";
import { useWallet } from "../wallet/WalletProvider";
import { useAlerts, useWatchlist, watchKey } from "@/hooks/useWatchlist";
import { getRecentSignatures, getSolBalance, getSplHoldings, SOL_MINT, type SigInfo } from "@/lib/wallet/rpc";
import { evmNativeBalance } from "@/lib/wallet/evm";
import { chainFromEvmId, getChain } from "@/lib/chains";
import { formatNumber, formatPrice, formatUsd, shortAddress, timeAgo } from "@/lib/format";
import { Badge, Button, Card, CardHeader, Notice } from "../ui/primitives";
import { TokenIcon } from "../ui/TokenIcon";
import { DataStatus } from "../ui/DataStatus";
import { ActivityPanel } from "./ActivityPanel";
import { PortfolioIntro } from "./PortfolioIntro";

interface Holding { mint: string; symbol: string; name: string; icon: string | null; amount: number; price: number | null; value: number | null; verified: boolean; network?: string; token?: string }

export function Portfolio() {
  const { wallet, session, signIn } = useWallet();
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [native, setNative] = useState<number | null>(null);
  const [sigs, setSigs] = useState<SigInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!wallet) return;
    setLoading(true); setErr(null);
    try {
      if (wallet.chainType === "solana") {
        const [sol, spl, s] = await Promise.all([getSolBalance(wallet.address), getSplHoldings(wallet.address), getRecentSignatures(wallet.address, 15).catch(() => null)]);
        setSigs(s);
        const mints = [SOL_MINT, ...spl.map((h) => h.mint)].slice(0, 100);
        const info = await fetch(`/api/swap/tokens-info?ids=${mints.join(",")}`).then((r) => r.json()).catch(() => ({ data: [] }));
        const meta = new Map<string, { symbol: string; name: string; icon: string | null; usdPrice: number | null; verified: boolean }>((info.data ?? []).map((t: { address: string; symbol: string; name: string; icon: string | null; usdPrice: number | null; verified: boolean }) => [t.address, t]));
        const list: Holding[] = [{ mint: SOL_MINT, amount: sol }, ...spl].map((h) => {
          const m = meta.get(h.mint);
          const price = m?.usdPrice ?? null;
          return { mint: h.mint, symbol: m?.symbol ?? shortAddress(h.mint), name: m?.name ?? "Unknown token", icon: m?.icon ?? null, amount: h.amount, price, value: price !== null ? price * h.amount : null, verified: !!m?.verified };
        });
        list.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
        setHoldings(list);
      } else {
        const r = await fetch(`/api/wallet/portfolio?evm=${wallet.address}`).then((x) => x.json());
        if (r.error) throw new Error(r.error);
        const hs = (r.data?.holdings ?? []) as { network: string; networkName: string; token: string; symbol: string; name: string; amount: number; usdPrice: number | null; usdValue: number | null }[];
        setHoldings(hs.filter((h) => h.amount > 0).map((h) => ({ mint: `${h.network}:${h.token}`, symbol: h.symbol, name: `${h.name} · ${h.networkName}`, icon: null, amount: h.amount, price: h.usdPrice, value: h.usdValue, verified: true, network: h.network, token: h.token })));
        const p = (await import("@/lib/wallet/evm")).getEvmProvider(wallet.walletId);
        if (p) setNative(await evmNativeBalance(p, wallet.address).catch(() => null));
      }
      setAt(Date.now());
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [wallet]);
  useEffect(() => { load(); }, [load]);

  if (!wallet) {
    return (
      <div className="space-y-6">
        <PortfolioIntro />
        <div className="grid gap-4 lg:grid-cols-2">
          <ActivityPanel />
          <WatchAndAlerts />
        </div>
      </div>
    );
  }
  const total = holdings?.reduce((s, h) => s + (h.value ?? 0), 0) ?? null;
  const chainName = wallet.chainType === "solana" ? "Solana" : chainFromEvmId(wallet.chainId ?? 0)?.name ?? `Chain ${wallet.chainId}`;
  const evmChain = wallet.chainType === "evm" ? chainFromEvmId(wallet.chainId ?? 0) : null;
  const signedIn = session?.address.toLowerCase() === wallet.address.toLowerCase();
  return (
    <div className="space-y-4">
      <h1 className="text-[30px] sm:text-[34px] leading-tight">Portfolio</h1>
      <div className="panel p-5 flex flex-wrap items-center gap-4">
        <div className="min-w-0">
          <div className="text-[13px] text-muted">Total value</div>
          <div className="text-[34px] font-semibold num leading-tight" data-testid="portfolio-total">{total !== null ? formatUsd(total) : "—"}</div>
          <div className="text-[13px] text-muted mt-0.5 flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" />{wallet.walletName} · {chainName} · <span className="num">{shortAddress(wallet.address, 4, 4)}</span></div>
        </div>
        {signedIn ? <Badge tone="up"><ShieldCheck size={11} /> Signed in</Badge> : <Button size="sm" variant="subtle" onClick={signIn}><ShieldCheck size={13} /> Sign in with wallet</Button>}
        <div className="flex-1" />
        <DataStatus fetchedAt={at} expectedMs={60_000} error={err} source={wallet.chainType === "solana" ? "Solana RPC" : "Wallet provider"} />
        <Button size="sm" variant="subtle" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh</Button>
      </div>
      {err && <Notice tone="down" title="Could not load balances">{err}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4 min-w-0">
          {holdings !== null || wallet.chainType === "solana" ? (
            <Card>
              <CardHeader title="Holdings" sub={holdings ? `${holdings.length} asset${holdings.length === 1 ? "" : "s"}` : undefined} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="text-xs text-muted border-y border-line"><tr><th className="text-left px-4 py-2 font-medium">Token</th><th className="text-right px-3 font-medium">Balance</th><th className="text-right px-3 font-medium">Price</th><th className="text-right px-4 font-medium">Value</th></tr></thead>
                  <tbody>
                    {holdings?.map((h) => (
                      <tr key={h.mint} className="border-b border-line/60 last:border-0">
                        <td className="px-4 py-2.5"><Link href={h.network ? (h.token?.startsWith("0xEeee") || h.token === "native" ? `/trade?symbol=${h.symbol}USDT` : `/token/${h.network}/${h.token}`) : h.mint === SOL_MINT ? "/coin/solana" : `/token/solana/${h.mint}`} className="flex items-center gap-2.5"><TokenIcon src={h.icon} symbol={h.symbol} size={26} /><span><span className="font-semibold">{h.symbol}</span>{!h.verified && <Badge tone="warn" className="ml-1.5">Unverified</Badge>}<span className="block text-[11px] text-muted">{h.name}</span></span></Link></td>
                        <td className="px-3 text-right num">{formatNumber(h.amount, 4)}</td>
                        <td className="px-3 text-right num">{formatPrice(h.price)}</td>
                        <td className="px-4 text-right num">{formatUsd(h.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!holdings && <div className="p-8 text-center text-sm text-muted">{loading ? "Loading balances…" : "No data"}</div>}
              </div>
            </Card>
          ) : (
            <Card className="p-4 space-y-3">
              <div className="text-xs text-muted">Native balance on {chainName}</div>
              <div className="text-3xl font-bold num">{native !== null ? `${formatNumber(native, 5)} ${evmChain?.nativeSymbol ?? "ETH"}` : "—"}</div>
              <Notice>Loading token balances… {evmChain && <a className="underline" href={`${evmChain.explorer.address}${wallet.address}`} target="_blank" rel="noopener noreferrer">View on explorer ↗</a>}</Notice>
            </Card>
          )}
          {wallet.chainType === "solana" && (
            <Card>
              <CardHeader title="Recent transactions" />
              <ul className="px-4 pb-4 space-y-1.5 text-sm">
                {sigs?.map((s) => (
                  <li key={s.signature} className="flex items-center gap-3">
                    <span className={`h-2 w-2 rounded-full ${s.err ? "bg-down" : "bg-up"}`} />
                    <a href={`${getChain("solana")!.explorer.tx}${s.signature}`} target="_blank" rel="noopener noreferrer" className="num text-xs hover:text-brand inline-flex items-center gap-1">{shortAddress(s.signature, 8, 8)} <ExternalLink size={10} /></a>
                    <span className="flex-1" />
                    <span className="text-xs text-muted">{s.err ? "Failed" : "Success"} · {s.blockTime ? timeAgo(s.blockTime * 1000) : "—"}</span>
                  </li>
                ))}
                {sigs && !sigs.length && <li className="text-xs text-muted">No transactions yet.</li>}
                {!sigs && <li className="text-xs text-muted">{loading ? "Loading…" : "Transaction history unavailable from the configured RPC."}</li>}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-4"><ActivityPanel wallet={wallet.address} /><WatchAndAlerts /></div>
      </div>
    </div>
  );
}

function WatchAndAlerts() {
  const wl = useWatchlist();
  const al = useAlerts();
  return (
    <div className="space-y-4 text-left mt-6 lg:mt-0">
      <Card>
        <CardHeader title="Watchlist" sub={`${wl.items.length} saved on this device`} />
        <ul className="px-4 pb-4 space-y-1.5 text-sm">
          {wl.items.map((i) => (
            <li key={watchKey(i)} className="flex items-center gap-2">
              <Link href={i.kind === "coin" ? `/coin/${i.id}` : `/token/${i.chain}/${i.address}`} className="flex-1 hover:text-brand font-medium">{i.label}</Link>
              <span className="text-xs text-muted">{i.kind === "coin" ? "Listed coin" : getChain(i.chain)?.name}</span>
              <button onClick={() => wl.remove(watchKey(i))} aria-label={`Remove ${i.label}`} className="text-faint hover:text-down"><Trash2 size={13} /></button>
            </li>
          ))}
          {!wl.items.length && <li className="text-xs text-muted">Tap ☆ on any token to add it here.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Price alerts" icon={<BellRing size={14} className="text-brand" />} sub="Checked every 30s while Bajar is open" />
        <ul className="px-4 pb-4 space-y-1.5 text-sm">
          {al.alerts.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span className="flex-1">{a.label} <span className="text-muted text-xs">{a.condition} {formatPrice(a.price)}</span></span>
              {a.triggeredAt ? <Badge tone="up">Triggered</Badge> : <Badge>Active</Badge>}
              <button onClick={() => al.remove(a.id)} aria-label="Delete alert" className="text-faint hover:text-down"><Trash2 size={13} /></button>
            </li>
          ))}
          {!al.alerts.length && <li className="text-xs text-muted">Ask Bajar Intelligence to set an alert, e.g. “alert me if SOL drops below $80”.</li>}
        </ul>
      </Card>
    </div>
  );
}

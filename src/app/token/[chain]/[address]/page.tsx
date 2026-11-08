import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getChain, isValidAddressFor } from "@/lib/chains";
import { getTokenPairs } from "@/lib/market/dexscreener";
import { getTokenInfo, type TokenInfo } from "@/lib/market/geckoterminal";
import { getTokenSecurity } from "@/lib/security/goplus";
import { errorMessage } from "@/lib/server/cache";
import { tokenInsights } from "@/lib/analytics/insights";
import { formatPrice, formatUsd } from "@/lib/format";
import type { RiskReport } from "@/lib/security/risk";
import { Card, CardHeader, Notice } from "@/components/ui/primitives";
import { ProChart } from "@/components/chart/ProChart";
import { TradeFeed } from "@/components/trade/TradeFeed";
import { AiSummary } from "@/components/ai/AiSummary";
import { MarketNews } from "@/components/market/SideFeeds";
import { TokenHeader } from "@/components/token/TokenHeader";
import { BuySellActivity, PairsTable, TokenStats } from "@/components/token/TokenStats";
import { HolderPanel, RiskPanel } from "@/components/token/RiskPanel";
import { AssetWorkspace } from "@/components/asset/AssetWorkspace";
import type { ExecAsset } from "@/components/asset/AssetExecution";
import { ZEROX_CHAINS } from "@/lib/treasury/tokens";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ chain: string; address: string }>; searchParams?: Promise<{ pair?: string }> };

async function loadPairs(chainId: string, address: string) {
  const chain = getChain(chainId);
  if (!chain || !isValidAddressFor(chain, address)) return null;
  return { chain, env: await getTokenPairs(chain.dexscreener, address) };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { chain, address } = await params;
  try {
    const r = await loadPairs(chain, address);
    const p = r?.env.data[0];
    if (!p) return { title: "Token not found" };
    return {
      title: `${p.base.symbol} (${p.base.name}) on ${r!.chain.name} — price & chart`,
      description: `${p.base.name} price ${formatPrice(p.priceUsd)}, liquidity ${formatUsd(p.liquidityUsd)}, 24h volume ${formatUsd(p.volume.h24)}. Live chart, trades, holders and contract risk analysis on Bajar.`,
      alternates: { canonical: `/token/${chain}/${address}` },
    };
  } catch {
    return { title: "Token" };
  }
}

export default async function TokenPage({ params, searchParams }: Params) {
  const pairParam = (await searchParams)?.pair;
  const { chain: chainId, address } = await params;
  let r: Awaited<ReturnType<typeof loadPairs>>;
  try {
    r = await loadPairs(chainId, address);
  } catch (e) {
    return <Notice tone="down" title="Market data temporarily unavailable" className="my-10">{errorMessage(e)}. Please retry shortly.</Notice>;
  }
  if (!r) notFound();
  const { chain, env } = r;
  // Keep the pool the user tapped (Discover, search, feeds) — fall back to the deepest pool.
  const top = (pairParam && env.data.find((x) => x.pairAddress.toLowerCase() === pairParam.toLowerCase())) || env.data[0];
  if (!top) {
    return (
      <Notice title="No trading pairs found" className="my-10">
        No active liquidity pools were found for <span className="num">{address}</span> on {chain.name}. The token may not be launched yet, or may trade on another network.
      </Notice>
    );
  }
  const [infoR, secR] = await Promise.allSettled([getTokenInfo(chain.geckoterminal, address), getTokenSecurity(chain, address)]);
  const info: TokenInfo | null = infoR.status === "fulfilled" ? infoR.value.data : null;
  const security: RiskReport | null = secR.status === "fulfilled" ? secR.value.data : null;
  const secError = secR.status === "rejected" ? errorMessage(secR.reason) : null;

  const verified: { label: string; tone: "up" | "brand" | "info" }[] = [];
  if (info?.verified) verified.push({ label: "GT Verified", tone: "up" });
  if (security?.trusted) verified.push({ label: "Trusted", tone: "up" });
  if (security?.openSource) verified.push({ label: "Source verified", tone: "info" });
  if (info?.coingeckoId) verified.push({ label: "Listed", tone: "brand" });

  const socials = [
    ...top.websites.map((w) => ({ label: w.label || "Website", url: w.url })),
    ...top.socials.map((s) => ({ label: s.type, url: s.url })),
  ].filter((x) => /^https?:\/\//.test(x.url));
  const top10 = info?.holders?.top10 ?? security?.top10Pct ?? null;

  const execAsset: ExecAsset = {
    symbol: top.base.symbol, name: top.base.name, href: `/token/${chain.id}/${address}?pair=${top.pairAddress}`,
    chain: chain.id === "solana" || chain.id in ZEROX_CHAINS ? chain.id : null, token: address,
    unavailableReason: `In-app execution isn't available on ${chain.name} yet.`,
  };
  const ammNote = (
    <Card>
      <CardHeader title="Liquidity" sub={`${top.dex} · ${top.base.symbol}/${top.quote.symbol}`} />
      <div className="px-4 pb-4 space-y-2 text-[13px]">
        <div className="flex justify-between"><span className="text-muted">Pool liquidity</span><span className="num font-medium">{formatUsd(top.liquidityUsd)}</span></div>
        <div className="flex justify-between"><span className="text-muted">24h volume</span><span className="num">{formatUsd(top.volume.h24)}</span></div>
        <p className="text-xs text-muted leading-relaxed pt-1">This pair trades on an automated market maker, which prices trades from pool reserves instead of an order book. Larger orders move the price more — check price impact before confirming.</p>
      </div>
    </Card>
  );

  return (
    <AssetWorkspace
      asset={execAsset}
      header={<TokenHeader chain={chain.id} address={address} initial={env} image={info?.image ?? null} verified={verified} socials={socials} />}
      chart={<ProChart feed={{ kind: "dex", chain: chain.id, pool: top.pairAddress }} label={`${top.base.symbol}/${top.quote.symbol} · ${top.dex}`} height={460} />}
      market={ammNote}
      activity={<TradeFeed source={{ kind: "dex", chain: chain.id, pool: top.pairAddress, base: top.base.symbol }} height={360} />}
      overview={
        <>
          <TokenStats chain={chain.id} address={address} initial={env} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TradeFeed source={{ kind: "dex", chain: chain.id, pool: top.pairAddress, base: top.base.symbol }} height={380} />
            <div className="space-y-4">
              <BuySellActivity chain={chain.id} address={address} initial={env} />
              {ammNote}
            </div>
          </div>
          <PairsTable chain={chain.id} address={address} initial={env} />
        </>
      }
      rail={
        <>
          <RiskPanel report={security} error={secError} info={info} />
          <HolderPanel report={security} info={info} />
          <AiSummary context={{ kind: "token", chain: chain.id, address }} name={`${top.base.name} (${top.base.symbol}) on ${chain.name}`} insights={tokenInsights(top, { top10Pct: top10, riskLevel: security?.level, pairCount: env.data.length })} />
          {info?.description && (
            <Card><CardHeader title={`About ${top.base.symbol}`} /><p className="px-4 pb-4 text-[13px] text-muted leading-relaxed line-clamp-[8]">{info.description}</p></Card>
          )}
          <MarketNews limit={3} query={`${top.base.name},${top.base.symbol}`} />
        </>
      }
    />
  );
}

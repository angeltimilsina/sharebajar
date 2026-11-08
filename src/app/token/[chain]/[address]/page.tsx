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
import { absolute } from "@/lib/site";
import { formatPct } from "@/lib/format";
import { Breadcrumbs, DataSummary, JsonLd, RelatedLinks } from "@/components/seo/SeoBlocks";
import { trendingSearches } from "@/lib/seo/agent";

/** Pools thinner than this aren't worth indexing (mostly spam / rugs). */
const INDEX_MIN_LIQUIDITY = 10_000;

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
      title: `${p.base.name} (${p.base.symbol}) price today on ${r!.chain.name} — live chart`,
      description: `${p.base.name} (${p.base.symbol}) price ${formatPrice(p.priceUsd)}, liquidity ${formatUsd(p.liquidityUsd)}, 24h volume ${formatUsd(p.volume.h24)}. Live chart, trades, holders and contract risk checks on Bajar.`,
      keywords: [`${p.base.symbol} price`, `${p.base.name} price`, `${p.base.symbol} ${r!.chain.name}`, `${p.base.symbol} chart`],
      alternates: { canonical: `/token/${chain}/${address}` },
      robots: { index: (p.liquidityUsd ?? 0) >= INDEX_MIN_LIQUIDITY, follow: true },
      openGraph: { title: `${p.base.name} (${p.base.symbol}) on ${r!.chain.name}`, url: `/token/${chain}/${address}`, type: "website" },
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

  const trending = await trendingSearches();
  const at = Date.now();
  const summary = [
    `${top.base.name} (${top.base.symbol}) trades at ${formatPrice(top.priceUsd)} on ${chain.name}${top.change.h24 !== null ? `, ${formatPct(top.change.h24)} over 24 hours` : ""}. Its deepest pool, ${top.base.symbol}/${top.quote.symbol} on ${top.dex}, holds ${formatUsd(top.liquidityUsd)} of liquidity with ${formatUsd(top.volume.h24)} traded in 24 hours.`,
    `${top.txns.h24.buys.toLocaleString("en-US")} buys and ${top.txns.h24.sells.toLocaleString("en-US")} sells in the last 24 hours across ${env.data.length} pool${env.data.length === 1 ? "" : "s"}.${security?.level ? ` Contract risk check: ${security.level}.` : ""}`,
  ];
  return (
    <>
    <JsonLd data={{
      "@context": "https://schema.org", "@type": "WebPage", name: `${top.base.name} (${top.base.symbol}) price on ${chain.name}`,
      url: absolute(`/token/${chain.id}/${address}`), dateModified: new Date(at).toISOString(),
      mainEntity: { "@type": "ExchangeRateSpecification", currency: top.base.symbol, currentExchangeRate: top.priceUsd !== null ? { "@type": "UnitPriceSpecification", price: top.priceUsd, priceCurrency: "USD" } : undefined },
    }} />
    <Breadcrumbs items={[{ label: "Bajar", href: "/" }, { label: "Discover", href: "/discover" }, { label: chain.name, href: `/markets/${({ solana: "solana-tokens", ethereum: "ethereum-tokens", base: "base-tokens", bsc: "bnb-chain-tokens" } as Record<string, string>)[chain.id] ?? "trending-tokens"}` }, { label: top.base.symbol, href: `/token/${chain.id}/${address}` }]} />
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
    <section className="mt-8 space-y-6" aria-label={`About the ${top.base.name} price`}>
      <h2 className="text-xl">{top.base.name} price today</h2>
      <DataSummary summary={summary} updated={at} />
      <RelatedLinks title="Trending searches" links={trending} testid="trending-searches" />
    </section>
    </>
  );
}

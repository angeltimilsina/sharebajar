import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Globe } from "lucide-react";
import { getCoin, CG_PLATFORM_TO_CHAIN, type CoinDetail } from "@/lib/market/coingecko";
import { binanceSymbolFor } from "@/lib/market/binance";
import { UpstreamError } from "@/lib/server/http";
import { coinInsights } from "@/lib/analytics/insights";
import { formatNumber, formatPrice, formatUsd, shortAddress } from "@/lib/format";
import { getChain } from "@/lib/chains";
import { Card, CardHeader, Notice, Pct, Stat, Badge } from "@/components/ui/primitives";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { ChainIcon } from "@/components/ui/ChainIcon";
import { ProChart } from "@/components/chart/ProChart";
import { OrderBook } from "@/components/trade/OrderBook";
import { TradeFeed } from "@/components/trade/TradeFeed";
import { AiSummary } from "@/components/ai/AiSummary";
import { MarketNews } from "@/components/market/SideFeeds";
import { LivePrice } from "@/components/market/LivePrice";
import { TokenActions } from "@/components/market/TokenActions";

export const dynamic = "force-dynamic";

async function load(id: string): Promise<{ coin: CoinDetail; fetchedAt: number; stale: boolean } | null> {
  try {
    const env = await getCoin(id);
    return { coin: env.data, fetchedAt: env.fetchedAt, stale: env.stale };
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const r = await load(id);
    if (!r) return { title: "Coin not found" };
    const c = r.coin;
    return {
      title: `${c.name} (${c.symbol}) price, chart & market data`,
      description: `Live ${c.name} price ${formatPrice(c.market.price)}, market cap ${formatUsd(c.market.marketCap)}, 24h volume ${formatUsd(c.market.volume24h)}. Real-time charts, order book and analysis on ShareBajar.`,
      alternates: { canonical: `/coin/${c.id}` },
      openGraph: { images: c.image ? [c.image] : undefined },
    };
  } catch {
    return { title: id };
  }
}

export default async function CoinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(id)) notFound();
  let r: Awaited<ReturnType<typeof load>>;
  try {
    r = await load(id);
  } catch (e) {
    return <Notice tone="down" title="Market data temporarily unavailable" className="my-10">{e instanceof Error ? e.message : String(e)}. Please retry in a moment.</Notice>;
  }
  if (!r) notFound();
  const c = r.coin;
  const m = c.market;
  let pair = await binanceSymbolFor(c.symbol);
  // Guard against symbol collisions: Binance pair must be the same asset (price within 5%).
  if (pair && m.price) {
    try {
      const t = await fetch(`${process.env.BINANCE_REST_URL || "https://data-api.binance.vision"}/api/v3/ticker/price?symbol=${pair}`, { cache: "no-store", signal: AbortSignal.timeout(4000) }).then((x) => x.json());
      if (!(Math.abs(Number(t.price) - m.price) / m.price < 0.05)) pair = null;
    } catch { /* keep pair */ }
  }
  const contracts = Object.entries(c.platforms).map(([p, addr]) => ({ chain: CG_PLATFORM_TO_CHAIN[p], platform: p, addr })).filter((x) => x.addr);
  const solMint = contracts.find((x) => x.chain === "solana")?.addr ?? (c.id === "solana" ? "So11111111111111111111111111111111111111112" : undefined);

  const jsonLd = { "@context": "https://schema.org", "@type": "FinancialProduct", name: `${c.name} (${c.symbol})`, description: c.description.slice(0, 300), url: `/coin/${c.id}` };

  return (
    <div className="space-y-4">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {/* header */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 min-w-0">
          <TokenIcon src={c.image} symbol={c.symbol} size={44} />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 flex-wrap">{c.name} <span className="text-muted text-base font-medium">{c.symbol}</span>{m.rank && <Badge>Rank #{m.rank}</Badge>}</h1>
            <div className="flex flex-wrap gap-1.5 mt-1">{c.categories.slice(0, 4).map((x) => <Badge key={x}>{x}</Badge>)}</div>
          </div>
        </div>
        <LivePrice symbol={pair} fallback={m.price} fallbackChange={m.change24h} fetchedAt={r.fetchedAt} />
        <div className="flex-1" />
        <TokenActions watch={{ kind: "coin", id: c.id, label: c.symbol }} swapHref={solMint ? `/trade?output=${solMint}` : undefined} tradeHref={pair ? `/trade?symbol=${pair}` : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 min-w-0">
          <ProChart feed={pair ? { kind: "binance", symbol: pair } : { kind: "coingecko", id: c.id }} label={pair ? `${c.symbol}/USDT` : `${c.symbol}/USD`} height={480} />
          <Card className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Market Cap" value={formatUsd(m.marketCap)} />
            <Stat label="Fully Diluted Valuation" value={formatUsd(m.fdv)} />
            <Stat label="24h Volume" value={formatUsd(m.volume24h)} />
            <Stat label="Vol / MCap" value={m.volume24h && m.marketCap ? `${((m.volume24h / m.marketCap) * 100).toFixed(2)}%` : "—"} />
            <Stat label="Circulating Supply" value={`${formatNumber(m.circulatingSupply)} ${c.symbol}`} />
            <Stat label="Total Supply" value={formatNumber(m.totalSupply)} />
            <Stat label="Max Supply" value={m.maxSupply ? formatNumber(m.maxSupply) : "∞"} />
            <Stat label="24h Range" value={`${formatPrice(m.low24h)} – ${formatPrice(m.high24h)}`} />
            <Stat label="All-Time High" value={formatPrice(c.ath)} sub={c.athDate ? <span className="text-muted">{new Date(c.athDate).toLocaleDateString()}</span> : undefined} />
            <Stat label="All-Time Low" value={formatPrice(c.atl)} sub={c.atlDate ? <span className="text-muted">{new Date(c.atlDate).toLocaleDateString()}</span> : undefined} />
            <Stat label="1h / 7d" value={<span className="flex gap-2"><Pct v={m.change1h} /><Pct v={m.change7d} /></span>} />
            <Stat label="Data" value={<span className="text-xs font-normal text-muted">CoinGecko{r.stale ? " (cached)" : ""}</span>} />
          </Card>
          {pair && <TradeFeed source={{ kind: "binance", symbol: pair, base: c.symbol }} height={360} />}
        </div>
        <div className="space-y-4 min-w-0">
          {pair ? <OrderBook symbol={pair} base={c.symbol} /> : <Notice>No live order book: {c.name} has no Binance spot USDT market. Charts use CoinGecko price history.</Notice>}
          <AiSummary context={{ kind: "coin", id: c.id }} name={`${c.name} (${c.symbol})`} insights={coinInsights(m, c.ath)} />
          {contracts.length > 0 && (
            <Card>
              <CardHeader title="Contracts" />
              <ul className="px-4 pb-4 space-y-2 text-sm">
                {contracts.map((x) => (
                  <li key={x.platform} className="flex items-center gap-2">
                    {x.chain ? <ChainIcon chain={x.chain} size={16} /> : <span className="h-4 w-4 rounded-full bg-surface-3" />}
                    <span className="text-muted text-xs w-20 truncate">{getChain(x.chain)?.name ?? x.platform}</span>
                    {x.chain ? <Link href={`/token/${x.chain}/${x.addr}`} className="num text-xs hover:text-brand">{shortAddress(x.addr, 6, 6)}</Link> : <span className="num text-xs">{shortAddress(x.addr, 6, 6)}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title={`About ${c.name}`} />
            <div className="px-4 pb-4 space-y-3">
              {c.description ? <p className="text-[13px] text-muted leading-relaxed line-clamp-[10] whitespace-pre-line">{c.description}</p> : <p className="text-xs text-muted">No description available.</p>}
              <div className="flex flex-wrap gap-2 text-xs">
                {c.links.homepage && <a href={c.links.homepage} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:bg-surface-2"><Globe size={12} /> Website</a>}
                {c.links.twitter && <a href={c.links.twitter} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:bg-surface-2">X / Twitter <ExternalLink size={11} /></a>}
                {c.links.github && <a href={c.links.github} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:bg-surface-2">GitHub <ExternalLink size={11} /></a>}
                {c.links.explorers.slice(0, 2).map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:bg-surface-2">Explorer <ExternalLink size={11} /></a>)}
              </div>
            </div>
          </Card>
          <MarketNews limit={4} query={`${c.name},${c.symbol}`} />
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCoinDetail, type CoinDetail } from "@/lib/market/markets";
import { searchTokens } from "@/lib/trading/jupiter";
import { coinInsights } from "@/lib/analytics/insights";
import { errorMessage } from "@/lib/server/cache";
import { formatNumber, formatPrice, formatUsd } from "@/lib/format";
import { Badge, Card, CardHeader, Notice, Pct, Stat } from "@/components/ui/primitives";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { ProChart } from "@/components/chart/ProChart";
import { OrderBook } from "@/components/trade/OrderBook";
import { TradeFeed } from "@/components/trade/TradeFeed";
import { AiSummary } from "@/components/ai/AiSummary";
import { MarketNews } from "@/components/market/SideFeeds";
import { LivePrice } from "@/components/market/LivePrice";
import { TokenActions } from "@/components/market/TokenActions";

export const dynamic = "force-dynamic";
const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const r = await getCoinDetail(id);
    if (!r) return { title: "Coin not found" };
    const m = r.data.market;
    return {
      title: `${m.name} (${m.symbol}) price, chart & market data`,
      description: `Live ${m.name} price ${formatPrice(m.price)}, market cap ${formatUsd(m.marketCap)}. Real-time charts, order book, trades and exchange markets on Bajar.`,
      alternates: { canonical: `/coin/${m.id}` },
    };
  } catch {
    return { title: id };
  }
}

/** Solana mint for this asset, if it trades on Solana (verified tokens only). */
async function solanaMint(symbol: string): Promise<string | undefined> {
  if (symbol === "SOL") return SOL_MINT;
  try {
    const { data } = await searchTokens(symbol);
    const match = data.filter((t) => t.verified && t.symbol.toUpperCase() === symbol.toUpperCase()).sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0];
    return match && (match.liquidity ?? 0) > 100_000 ? match.address : undefined;
  } catch {
    return undefined;
  }
}

export default async function CoinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(id)) notFound();
  let r: { data: CoinDetail; fetchedAt: number; stale: boolean } | null;
  try {
    r = await getCoinDetail(id);
  } catch (e) {
    return <Notice tone="down" title="Market data temporarily unavailable" className="my-10">{errorMessage(e)}. Please retry in a moment.</Notice>;
  }
  if (!r) notFound();
  const { market: m, binancePair: pair, ath, atl, exchanges } = r.data;
  const mint = await solanaMint(m.symbol);
  const jsonLd = { "@context": "https://schema.org", "@type": "FinancialProduct", name: `${m.name} (${m.symbol})`, url: `/coin/${m.id}` };

  return (
    <div className="space-y-4">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 min-w-0">
          <TokenIcon src={m.image} symbol={m.symbol} size={44} />
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 flex-wrap">{m.name} <span className="text-muted text-base font-medium">{m.symbol}</span>{m.rank && <Badge>Rank #{m.rank}</Badge>}</h1>
        </div>
        <LivePrice symbol={pair} fallback={m.price} fallbackChange={m.change24h} fetchedAt={r.fetchedAt} />
        <div className="flex-1" />
        <TokenActions watch={{ kind: "coin", id: m.id, label: m.symbol }} swapHref={mint ? `/trade?output=${mint}` : undefined} tradeHref={pair ? `/trade?symbol=${pair}` : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 min-w-0">
          {pair ? <ProChart feed={{ kind: "binance", symbol: pair }} label={`${m.symbol}/USDT`} height={480} />
            : <Notice title="No live exchange chart">{m.name} has no Binance spot USDT market, so real-time candles aren&apos;t available. Prices below are aggregated across exchanges by CoinLore.</Notice>}
          <Card className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Market Cap" value={formatUsd(m.marketCap)} />
            <Stat label="Fully Diluted Valuation" value={formatUsd(m.fdv)} />
            <Stat label="Reported 24h Volume" value={formatUsd(m.volume24h)} sub={<span className="text-faint">all exchanges</span>} />
            <Stat label="Vol / MCap" value={m.volume24h && m.marketCap ? `${((m.volume24h / m.marketCap) * 100).toFixed(2)}%` : "—"} />
            <Stat label="Circulating Supply" value={`${formatNumber(m.circulatingSupply)} ${m.symbol}`} />
            <Stat label="Total Supply" value={formatNumber(m.totalSupply)} />
            <Stat label="Max Supply" value={m.maxSupply ? formatNumber(m.maxSupply) : "∞"} />
            <Stat label="24h Range" value={m.low24h !== null ? `${formatPrice(m.low24h)} – ${formatPrice(m.high24h)}` : "—"} />
            <Stat label="High since Binance listing" value={ath ? formatPrice(ath.price) : "—"} sub={ath ? <span className="text-muted">{new Date(ath.time).toLocaleDateString()}</span> : undefined} />
            <Stat label="Low since Binance listing" value={atl ? formatPrice(atl.price) : "—"} sub={atl ? <span className="text-muted">{new Date(atl.time).toLocaleDateString()}</span> : undefined} />
            <Stat label="1h / 7d" value={<span className="flex gap-2"><Pct v={m.change1h} /><Pct v={m.change7d} /></span>} />
            <Stat label="Data" value={<span className="text-xs font-normal text-muted">{pair ? "Binance live · CoinLore supply" : "CoinLore"}{r.stale ? " (cached)" : ""}</span>} />
          </Card>
          {pair && <TradeFeed source={{ kind: "binance", symbol: pair, base: m.symbol }} height={360} />}
        </div>
        <div className="space-y-4 min-w-0">
          {pair ? <OrderBook symbol={pair} base={m.symbol} /> : <Notice>No live order book for this asset.</Notice>}
          <AiSummary context={{ kind: "coin", id: m.id }} name={`${m.name} (${m.symbol})`} insights={coinInsights(m, ath?.price)} />
          <Card>
            <CardHeader title="Where it trades" sub="Top USD markets by volume · CoinLore" />
            {exchanges.length ? (
              <table className="w-full text-[12.5px] num mb-3">
                <thead className="text-faint text-[11px]"><tr><th className="text-left font-normal px-4 py-1">Exchange</th><th className="text-right font-normal">Price</th><th className="text-right font-normal px-4">24h Vol</th></tr></thead>
                <tbody>
                  {exchanges.slice(0, 8).map((x) => (
                    <tr key={x.exchange + x.pair} className="border-t border-line/60">
                      <td className="px-4 py-1.5"><span className="font-medium">{x.exchange}</span> <span className="text-faint">{x.pair}</span></td>
                      <td className="text-right">{formatPrice(x.price)}</td>
                      <td className="text-right px-4">{formatUsd(x.volumeUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="px-4 pb-4 text-xs text-muted">Exchange market data unavailable.</p>}
          </Card>
          <MarketNews limit={4} query={`${m.name},${m.symbol}`} />
        </div>
      </div>
    </div>
  );
}

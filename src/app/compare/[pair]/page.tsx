import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { comparePage, trendingSearches, type Perf } from "@/lib/seo/agent";
import { pairSlug, parsePair } from "@/lib/seo/topics";
import { getMarkets } from "@/lib/market/markets";
import { errorMessage } from "@/lib/server/cache";
import { formatNumber, formatPrice, formatUsd } from "@/lib/format";
import type { CoinMarket } from "@/lib/types";
import { Card, Notice, Pct } from "@/components/ui/primitives";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { Breadcrumbs, DataSummary, FaqSection, JsonLd, RelatedLinks } from "@/components/seo/SeoBlocks";
import { absolute } from "@/lib/site";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ pair: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const ids = parsePair((await params).pair);
  if (!ids) return { title: "Not found" };
  try {
    const { data } = await getMarkets({ ids });
    const [a, b] = ids.map((id) => data.find((c) => c.id === id));
    if (!a || !b) return { title: "Comparison not found" };
    const title = `${a.name} vs ${b.name}: ${a.symbol} vs ${b.symbol} price, market cap & performance`;
    return {
      title,
      description: `Compare ${a.name} (${formatPrice(a.price)}) and ${b.name} (${formatPrice(b.price)}): market cap, 24h/7d/30d/90d performance, volatility and correlation, from live data.`,
      keywords: [`${a.symbol} vs ${b.symbol}`, `${a.name} vs ${b.name}`, `${a.name} or ${b.name}`, `${b.symbol} vs ${a.symbol}`],
      alternates: { canonical: `/compare/${pairSlug(a.id, b.id)}` },
      openGraph: { title: `${a.name} vs ${b.name}`, url: `/compare/${pairSlug(a.id, b.id)}`, type: "website" },
    };
  } catch {
    return { title: "Compare coins" };
  }
}

const rows: { label: string; v: (c: CoinMarket, p: Perf) => React.ReactNode }[] = [
  { label: "Price", v: (c) => formatPrice(c.price) },
  { label: "Market cap", v: (c) => formatUsd(c.marketCap) },
  { label: "Rank", v: (c) => (c.rank ? `#${c.rank}` : "—") },
  { label: "24h volume", v: (c) => formatUsd(c.volume24h) },
  { label: "24h change", v: (c) => <Pct v={c.change24h} /> },
  { label: "7d change", v: (c) => <Pct v={c.change7d} /> },
  { label: "30d change", v: (_, p) => <Pct v={p.d30} /> },
  { label: "90d change", v: (_, p) => <Pct v={p.d90} /> },
  { label: "Volatility (90d, annualised)", v: (_, p) => (p.vol90 !== null ? `${p.vol90.toFixed(0)}%` : "—") },
  { label: "Circulating supply", v: (c) => formatNumber(c.circulatingSupply) },
  { label: "Max supply", v: (c) => (c.maxSupply ? formatNumber(c.maxSupply) : "No cap") },
  { label: "Fully diluted value", v: (c) => formatUsd(c.fdv) },
];

/** Both series rebased to 100, as a tiny inline chart (server-rendered SVG). */
function Rebased({ a, b, pa, pb }: { a: CoinMarket; b: CoinMarket; pa: Perf; pb: Perf }) {
  const n = Math.min(pa.closes.length, pb.closes.length);
  if (n < 8) return null;
  const sa = pa.closes.slice(-n).map((v, _, s) => (v / s[0]) * 100), sb = pb.closes.slice(-n).map((v, _, s) => (v / s[0]) * 100);
  const lo = Math.min(...sa, ...sb), hi = Math.max(...sa, ...sb), W = 640, H = 180;
  const path = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${((i / (n - 1)) * W).toFixed(1)},${(H - ((v - lo) / (hi - lo || 1)) * H).toFixed(1)}`).join("");
  return (
    <Card className="p-4">
      <h2 className="text-base mb-1">{n - 1}-day performance, rebased to 100</h2>
      <div className="flex gap-4 text-xs text-muted mb-2">
        <span className="flex items-center gap-1.5"><i className="w-3 h-0.5 bg-[var(--accent)] inline-block" />{a.symbol} {sa[n - 1].toFixed(0)}</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-0.5 bg-[var(--text)] inline-block opacity-60" />{b.symbol} {sb[n - 1].toFixed(0)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${a.symbol} and ${b.symbol} price performance over ${n - 1} days`} preserveAspectRatio="none">
        <path d={path(sa)} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={path(sb)} fill="none" stroke="var(--text)" strokeOpacity="0.6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="text-[11px] text-faint mt-1">Binance daily closes. Past performance doesn&apos;t predict future returns.</p>
    </Card>
  );
}

export default async function ComparePage({ params }: Params) {
  const slug = (await params).pair;
  const ids = parsePair(slug);
  if (!ids) notFound();
  let page: Awaited<ReturnType<typeof comparePage>>;
  try {
    page = await comparePage(ids[0], ids[1]);
  } catch (e) {
    return <Notice tone="down" title="Market data temporarily unavailable" className="my-10">{errorMessage(e)}. Please retry in a moment.</Notice>;
  }
  if (!page) notFound();
  const { a, b, pa, pb } = page;
  // One canonical order (larger market cap first) so "b-vs-a" doesn't split ranking signals.
  const canonical = pairSlug(a.id, b.id);
  if ((b.marketCap ?? 0) > (a.marketCap ?? 0)) permanentRedirect(`/compare/${pairSlug(b.id, a.id)}`);
  const trending = await trendingSearches();

  return (
    <div className="space-y-6 py-2">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "WebPage", name: `${a.name} vs ${b.name}`, url: absolute(`/compare/${canonical}`),
        about: [a, b].map((c) => ({ "@type": "Thing", name: c.name, alternateName: c.symbol, url: absolute(`/coin/${c.id}`) })),
        dateModified: new Date(page.fetchedAt).toISOString(),
      }} />
      <div>
        <Breadcrumbs items={[{ label: "Bajar", href: "/" }, { label: "Markets", href: "/markets" }, { label: `${a.symbol} vs ${b.symbol}`, href: `/compare/${canonical}` }]} />
        <h1 className="text-[28px] sm:text-[32px] leading-tight mb-3 flex flex-wrap items-center gap-2">
          <TokenIcon src={a.image} symbol={a.symbol} size={32} canonical /> {a.name} <span className="text-muted font-sans text-lg">vs</span> <TokenIcon src={b.image} symbol={b.symbol} size={32} canonical /> {b.name}
        </h1>
        <DataSummary intro={page.intro} summary={page.summary} updated={page.fetchedAt} />
      </div>
      <Card className="overflow-x-auto" data-testid="compare-table">
        <table className="w-full text-[13.5px] num">
          <thead className="text-xs text-muted border-b border-line">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Metric</th>
              {[a, b].map((c) => <th key={c.id} className="px-4 py-2.5 text-right font-medium"><Link href={`/coin/${c.id}`} className="hover:text-fg">{c.name} ({c.symbol})</Link></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-line/50">
                <td className="px-4 py-2.5 text-muted">{r.label}</td>
                <td className="px-4 py-2.5 text-right">{r.v(a, pa)}</td>
                <td className="px-4 py-2.5 text-right">{r.v(b, pb)}</td>
              </tr>
            ))}
            {page.corr90 !== null && (
              <tr><td className="px-4 py-2.5 text-muted">Correlation of daily returns (90d)</td><td colSpan={2} className="px-4 py-2.5 text-right">{page.corr90.toFixed(2)}</td></tr>
            )}
          </tbody>
        </table>
      </Card>
      <Rebased a={a} b={b} pa={pa} pb={pb} />
      <FaqSection faq={page.faq} />
      <RelatedLinks title="Related" links={page.related} />
      <RelatedLinks title="Trending searches" links={trending} testid="trending-searches" />
    </div>
  );
}

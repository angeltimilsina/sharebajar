import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { marketPage, trendingSearches } from "@/lib/seo/agent";
import { topicBySlug } from "@/lib/seo/topics";
import { errorMessage } from "@/lib/server/cache";
import { Card, Notice } from "@/components/ui/primitives";
import { PoolTable } from "@/components/market/PoolTable";
import { Breadcrumbs, CoinRankTable, DataSummary, FaqSection, JsonLd, RelatedLinks, itemListLd } from "@/components/seo/SeoBlocks";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const t = topicBySlug(slug);
  if (!t) return { title: "Not found" };
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return {
    title: `${t.title} (${today})`,
    description: `${t.blurb} Live prices, 24h and 7d change, market cap and volume — updated every few minutes on Bajar.`,
    keywords: t.queries,
    alternates: { canonical: `/markets/${t.slug}` },
    openGraph: { title: t.title, description: t.blurb, url: `/markets/${t.slug}`, type: "website" },
  };
}

export default async function MarketTopicPage({ params }: Params) {
  const { slug } = await params;
  if (!topicBySlug(slug)) notFound();
  let page: Awaited<ReturnType<typeof marketPage>>;
  try {
    page = await marketPage(slug);
  } catch (e) {
    return <Notice tone="down" title="Market data temporarily unavailable" className="my-10">{errorMessage(e)}. Please retry in a moment.</Notice>;
  }
  if (!page) notFound();
  const { topic: t } = page;
  const trending = await trendingSearches();
  const items = t.kind === "dex"
    ? page.pools.map((p) => ({ name: `${p.base.name} (${p.base.symbol})`, href: `/token/${p.network}/${p.base.address}` }))
    : page.coins.map((c) => ({ name: `${c.name} (${c.symbol})`, href: `/coin/${c.id}` }));

  return (
    <div className="space-y-6 py-2">
      <JsonLd data={itemListLd(t.title, items)} />
      <div>
        <Breadcrumbs items={[{ label: "Bajar", href: "/" }, { label: "Markets", href: "/markets" }, { label: t.label, href: `/markets/${t.slug}` }]} />
        <h1 className="text-[28px] sm:text-[32px] leading-tight mb-3">{t.title}</h1>
        <DataSummary intro={page.intro} summary={page.summary} updated={page.fetchedAt} />
      </div>
      <Card className="overflow-hidden" data-testid="seo-table">
        {t.kind === "dex" ? <PoolTable pools={page.pools} showSignals={false} /> : <CoinRankTable coins={page.coins} emphasis={t.metric} />}
      </Card>
      <p className="text-xs text-muted max-w-3xl">{t.blurb}</p>
      <FaqSection faq={page.faq} />
      <RelatedLinks title="More market lists" links={page.related} />
      <RelatedLinks title="Trending searches" links={trending} testid="trending-searches" />
    </div>
  );
}

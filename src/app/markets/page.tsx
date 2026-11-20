import type { Metadata } from "next";
import Link from "next/link";
import { TOPICS, comparePairs, pairSlug } from "@/lib/seo/topics";
import { trendingSearches, universe } from "@/lib/seo/agent";
import { Card, CardHeader } from "@/components/ui/primitives";
import { Breadcrumbs, RelatedLinks } from "@/components/seo/SeoBlocks";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Crypto markets: gainers, losers, sectors and comparisons",
  description: "Live crypto market lists — top gainers and losers, most traded, largest by market cap, sectors like DeFi, AI and meme coins, top tokens by chain, and head-to-head coin comparisons.",
  alternates: { canonical: "/markets" },
};

const GROUPS = [
  { kind: "ranking", title: "Rankings", sub: "Price moves, volume and size" },
  { kind: "category", title: "Sectors", sub: "Coins grouped by what they do" },
  { kind: "dex", title: "On-chain", sub: "Tokens trading on decentralized exchanges" },
] as const;

export default async function MarketsIndex() {
  let pairs: { label: string; href: string }[] = [];
  try {
    const { coins } = await universe();
    pairs = comparePairs(coins, 10).slice(0, 24).map(([a, b]) => ({ label: `${a.name} vs ${b.name}`, href: `/compare/${pairSlug(a.id, b.id)}` }));
  } catch { /* comparisons need live data */ }
  const trending = await trendingSearches();
  return (
    <div className="space-y-6 py-2">
      <div>
        <Breadcrumbs items={[{ label: "Bajar", href: "/" }, { label: "Markets", href: "/markets" }]} />
        <h1 className="text-[28px] sm:text-[32px] leading-tight">Crypto markets</h1>
        <p className="text-muted mt-1 max-w-2xl">Every list is built from live market data and refreshed every few minutes.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {GROUPS.map((g) => (
          <Card key={g.kind}>
            <CardHeader title={<h2 className="text-base">{g.title}</h2>} sub={g.sub} />
            <ul className="pb-2">
              {TOPICS.filter((t) => t.kind === g.kind).map((t) => (
                <li key={t.slug}><Link href={`/markets/${t.slug}`} className="block px-4 py-2 text-[14px] hover:bg-surface-2">{t.label}</Link></li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <RelatedLinks title="Compare coins" links={pairs} testid="compare-links" />
      <RelatedLinks title="Trending searches" links={trending} testid="trending-searches" />
    </div>
  );
}

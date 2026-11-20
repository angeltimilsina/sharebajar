import Link from "next/link";
import type { CoinMarket } from "@/lib/types";
import type { Faq, RelatedLink } from "@/lib/seo/agent";
import { absolute } from "@/lib/site";
import { formatPrice, formatUsd } from "@/lib/format";
import { Card, CardHeader, Pct } from "@/components/ui/primitives";
import { TokenIcon } from "@/components/ui/TokenIcon";

/** Renders schema.org JSON-LD safely (escapes "<" so data can't close the script tag). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export function Breadcrumbs({ items }: { items: { label: string; href: string }[] }) {
  return (
    <>
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.label, item: absolute(it.href) })),
      }} />
      <nav aria-label="Breadcrumb" className="text-xs text-muted flex flex-wrap gap-1.5 mb-3">
        {items.map((it, i) => (
          <span key={it.href} className="flex gap-1.5">
            {i > 0 && <span className="text-faint">/</span>}
            {i < items.length - 1 ? <Link href={it.href} className="hover:text-fg">{it.label}</Link> : <span className="text-fg">{it.label}</span>}
          </span>
        ))}
      </nav>
    </>
  );
}

/** Data-written summary. The AI intro (if any) is labelled so readers know its origin. */
export function DataSummary({ intro, summary, updated }: { intro?: string | null; summary: string[]; updated: number }) {
  return (
    <section className="space-y-2 text-[14.5px] leading-relaxed text-fg/90 max-w-3xl" data-testid="seo-summary">
      {intro && <p>{intro} <span className="text-[11px] text-faint align-middle">AI-written from the figures below</span></p>}
      {summary.map((s, i) => <p key={i}>{s}</p>)}
      <p className="text-xs text-faint">Updated <time dateTime={new Date(updated).toISOString()}>{new Date(updated).toISOString().slice(0, 16).replace("T", " ")} UTC</time> · Market data, not investment advice.</p>
    </section>
  );
}

export function FaqSection({ faq, title = "Frequently asked questions" }: { faq: Faq[]; title?: string }) {
  if (!faq.length) return null;
  return (
    <Card>
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "FAQPage",
        mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      }} />
      <CardHeader title={<h2 className="text-base">{title}</h2>} />
      <div className="divide-y divide-line/60">
        {faq.map((f) => (
          <details key={f.q} className="group px-4 py-3" open>
            <summary className="cursor-pointer list-none font-medium text-[14px] flex justify-between gap-3">{f.q}<span className="text-faint group-open:rotate-45 transition-transform">+</span></summary>
            <p className="mt-1.5 text-[13.5px] text-muted leading-relaxed">{f.a}</p>
          </details>
        ))}
      </div>
    </Card>
  );
}

export function RelatedLinks({ title, links, testid }: { title: string; links: RelatedLink[]; testid?: string }) {
  if (!links.length) return null;
  return (
    <section data-testid={testid}>
      <h2 className="text-sm font-sans font-semibold text-muted mb-2">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="px-3 py-1.5 rounded-full border border-line text-[13px] hover:bg-surface-2 hover:text-fg">{l.label}</Link>
        ))}
      </div>
    </section>
  );
}

/** Server-rendered, crawlable coin ranking. */
export function CoinRankTable({ coins, emphasis }: { coins: CoinMarket[]; emphasis?: string }) {
  if (!coins.length) return <p className="p-8 text-center text-sm text-muted">No coins match right now.</p>;
  const em = (k: string) => (emphasis === k ? "font-semibold text-fg" : "");
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full text-[13.5px] num">
        <thead className="text-xs text-muted border-b border-line">
          <tr>
            <th className="pl-3 pr-1 py-2.5 text-left font-medium w-8">#</th>
            <th className="px-3 py-2.5 text-left font-medium">Coin</th>
            <th className="px-3 py-2.5 text-right font-medium">Price</th>
            <th className="px-3 py-2.5 text-right font-medium">24h</th>
            <th className="px-3 py-2.5 text-right font-medium hidden sm:table-cell">7d</th>
            <th className="px-3 py-2.5 text-right font-medium hidden md:table-cell">Market cap</th>
            <th className="px-3 py-2.5 text-right font-medium hidden md:table-cell">Volume 24h</th>
          </tr>
        </thead>
        <tbody>
          {coins.map((c, i) => (
            <tr key={c.id} className="border-b border-line/50 hover:bg-surface-2/60">
              <td className="pl-3 pr-1 py-2.5 text-faint">{i + 1}</td>
              <td className="px-3 py-2.5">
                <Link href={`/coin/${c.id}`} className="flex items-center gap-2.5 min-w-0">
                  <TokenIcon src={c.image} symbol={c.symbol} size={24} canonical />
                  <span className="font-medium truncate max-w-[8.5rem] sm:max-w-none">{c.name}</span>
                  <span className="text-faint text-xs hidden sm:inline">{c.symbol}</span>
                </Link>
              </td>
              <td className="px-3 py-2.5 text-right">{formatPrice(c.price)}</td>
              <td className={`px-3 py-2.5 text-right ${em("change24h")}`}><Pct v={c.change24h} /></td>
              <td className={`px-3 py-2.5 text-right hidden sm:table-cell ${em("change7d")}`}><Pct v={c.change7d} /></td>
              <td className={`px-3 py-2.5 text-right hidden md:table-cell ${em("marketCap")}`}>{formatUsd(c.marketCap)}</td>
              <td className={`px-3 py-2.5 text-right hidden md:table-cell ${em("volume24h")}`}>{formatUsd(c.volume24h)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function itemListLd(name: string, items: { name: string; href: string }[]) {
  return {
    "@context": "https://schema.org", "@type": "ItemList", name,
    itemListElement: items.slice(0, 50).map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, url: absolute(it.href) })),
  };
}

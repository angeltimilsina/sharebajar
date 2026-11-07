import type { NewsItem } from "../types";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function tag(block: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
}

function attr(block: string, name: string, attribute: string): string | null {
  const re = new RegExp(`<${name}\\s[^>]*${attribute}="([^"]+)"`, "i");
  return block.match(re)?.[1] ?? null;
}

const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Minimal, dependency-free RSS 2.0 parser — enough for news feeds. */
export function parseRss(xml: string, source: string): NewsItem[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const out: NewsItem[] = [];
  for (const block of items) {
    const title = tag(block, "title");
    const link = tag(block, "link") ?? attr(block, "link", "href");
    if (!title || !link) continue;
    const date = tag(block, "pubDate") ?? tag(block, "dc:date");
    const desc = tag(block, "description") ?? "";
    const image =
      attr(block, "media:content", "url") ?? attr(block, "media:thumbnail", "url") ?? attr(block, "enclosure", "url") ??
      decodeEntities(desc).match(/<img[^>]+src="([^"]+)"/i)?.[1] ?? null;
    const url = decodeEntities(link).trim();
    if (!/^https?:\/\//.test(url)) continue;
    out.push({
      id: url,
      title: clean(title),
      url,
      source,
      publishedAt: date ? Date.parse(date) || 0 : 0,
      summary: clean(decodeEntities(desc)).slice(0, 280),
      image,
    });
  }
  return out;
}

/** Keyword relevance filter for token-specific news. */
export function filterNews(items: NewsItem[], terms: string[]): NewsItem[] {
  const words = terms.map((t) => t.trim()).filter((t) => t.length >= 3);
  if (!words.length) return [];
  const re = new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
  return items.filter((n) => re.test(n.title) || re.test(n.summary));
}

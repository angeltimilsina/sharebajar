import "server-only";
import { cached } from "../server/cache";
import { fetchUpstream } from "../server/http";
import { log } from "../server/log";
import { parseRss } from "./rss";
import type { NewsItem } from "../types";

const FEEDS = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "Decrypt", url: "https://decrypt.co/feed" },
];

export function getNews() {
  return cached("news:all", FEEDS.map((f) => f.source).join(", "), { ttlMs: 5 * 60_000, staleMs: 6 * 3600_000 }, async () => {
    const results = await Promise.allSettled(
      FEEDS.map(async (f) => parseRss(await fetchUpstream<string>(f.url, { text: true, timeoutMs: 10_000 }), f.source)),
    );
    const items: NewsItem[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") items.push(...r.value);
      else log("warn", "news feed failed", { feed: FEEDS[i].source, error: String(r.reason) });
    });
    if (!items.length) throw new Error("All news feeds unavailable");
    const seen = new Set<string>();
    return items
      .filter((n) => (seen.has(n.title) ? false : (seen.add(n.title), true)))
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, 80);
  });
}

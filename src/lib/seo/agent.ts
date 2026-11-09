import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { getGlobal, getMarkets } from "../market/markets";
import { getNewPools, getTopPools, getTrendingPools } from "../market/geckoterminal";
import { getKlines, getUsdtSymbols } from "../market/binance";
import { formatPct, formatPrice, formatUsd } from "../format";
import { log } from "../server/log";
import { AI_MODEL, aiConfigured } from "../ai/config";
import type { CoinMarket, GlobalStats, Pool } from "../types";
import { CATEGORIES, TOPICS, categoriesOf, comparePairs, correlation, pairSlug, topicBySlug, volatility, type Topic } from "./topics";

/**
 * Bajar's SEO agent. It reads live market data, decides which pages people are
 * searching for right now (rankings, sectors, chains, head-to-head comparisons),
 * and writes the copy for them from the numbers. Every figure on a page comes
 * from the data; the optional AI intro is rejected if it contains any number
 * that isn't in the facts it was given.
 */

export interface Faq { q: string; a: string }
export interface RelatedLink { label: string; href: string }

const pct = (v: number | null | undefined) => formatPct(v);
const abs = (v: number) => formatPct(Math.abs(v)).replace("+", "");
const asOf = (t: number) => `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const names = (cs: { name: string; symbol: string }[]) => cs.map((c) => `${c.name} (${c.symbol})`);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/* ------------------------------------------------------------------ data */

export async function universe(): Promise<{ coins: CoinMarket[]; fetchedAt: number }> {
  const env = await getMarkets({ perPage: 250 });
  return { coins: env.data, fetchedAt: env.fetchedAt };
}

async function globalStats(): Promise<GlobalStats | null> {
  try { return (await getGlobal()).data; } catch { return null; }
}

async function topicPools(t: Topic): Promise<Pool[]> {
  if (!t.dex) return [];
  const env = t.dex.source === "trending" ? await getTrendingPools() : t.dex.source === "new" ? await getNewPools() : await getTopPools(t.dex.network!);
  // One row per token (deepest pool), real prices only.
  const seen = new Set<string>();
  return env.data.filter((p) => p.priceUsd && p.base.address && !seen.has(`${p.network}:${p.base.address}`) && seen.add(`${p.network}:${p.base.address}`));
}

/* ------------------------------------------------------- market topic pages */

export interface MarketPage {
  topic: Topic;
  coins: CoinMarket[];
  pools: Pool[];
  fetchedAt: number;
  summary: string[];
  intro: string | null;
  faq: Faq[];
  related: RelatedLink[];
}

export async function marketPage(slug: string): Promise<MarketPage | null> {
  const topic = topicBySlug(slug);
  if (!topic) return null;
  if (topic.kind === "dex") {
    const pools = (await topicPools(topic)).slice(0, 50);
    const fetchedAt = Date.now();
    const { summary, faq, facts } = dexCopy(topic, pools, fetchedAt);
    return { topic, coins: [], pools, fetchedAt, summary, faq, intro: aiIntro(`m:${slug}`, topic.title, facts), related: relatedTopics(topic) };
  }
  const [{ coins: all, fetchedAt }, global] = await Promise.all([universe(), globalStats()]);
  const coins = topic.select!(all).slice(0, 100);
  const { summary, faq, facts } = coinCopy(topic, coins, all, global, fetchedAt);
  return { topic, coins, pools: [], fetchedAt, summary, faq, intro: aiIntro(`m:${slug}`, topic.title, facts), related: relatedTopics(topic) };
}

function coinCopy(t: Topic, coins: CoinMarket[], all: CoinMarket[], g: GlobalStats | null, at: number) {
  const summary: string[] = [];
  const faq: Faq[] = [];
  const top = coins.slice(0, 3);
  const m = t.metric ?? "marketCap";
  const val = (c: CoinMarket) => (m === "change24h" || m === "change7d" ? pct(c[m]) : formatUsd(c[m]));
  const window = m === "change7d" ? "7 days" : "24 hours";

  if (!coins.length) {
    summary.push(`No coins currently match “${t.label}”. The list refreshes with live data every few minutes.`);
  } else if (t.kind === "ranking") {
    summary.push(`As of ${asOf(at)}, ${names(top.slice(0, 1))[0]} leads ${t.label.toLowerCase()} at ${val(top[0])}${top.length > 1 ? `, followed by ${list(top.slice(1).map((c) => `${c.name} (${val(c)})`))}` : ""}.`);
    const liquid = all.filter((c) => (c.volume24h ?? 0) >= 1e6);
    const up = liquid.filter((c) => (c.change24h ?? 0) > 0).length;
    summary.push(`Of ${liquid.length} liquid coins tracked, ${up} are up and ${liquid.length - up} are down over 24 hours.`);
  } else {
    const cat = CATEGORIES[t.slug];
    const cap = coins.reduce((s, c) => s + (c.marketCap ?? 0), 0);
    const vol = coins.reduce((s, c) => s + (c.volume24h ?? 0), 0);
    const wChange = cap ? coins.reduce((s, c) => s + (c.marketCap ?? 0) * (c.change24h ?? 0), 0) / cap : null;
    const lead = coins[0];
    summary.push(`Bajar tracks ${coins.length} ${cat.label.toLowerCase()} — ${cat.about} — with a combined market cap of ${formatUsd(cap)} and ${formatUsd(vol)} traded in the last 24 hours.`);
    summary.push(`${lead.name} (${lead.symbol}) is the largest at ${formatUsd(lead.marketCap)}, ${cap ? ((100 * (lead.marketCap ?? 0)) / cap).toFixed(1) : "—"}% of the category. The market-cap-weighted 24h change for the group is ${pct(wChange)}.`);
    const ranked = [...coins].filter((c) => c.change24h !== null).sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));
    if (ranked.length > 1) summary.push(`Best 24h performer: ${ranked[0].name} (${pct(ranked[0].change24h)}). Weakest: ${ranked[ranked.length - 1].name} (${pct(ranked[ranked.length - 1].change24h)}).`);
    faq.push({ q: `What is the largest ${cat.label.toLowerCase().replace(/s$/, "")} by market cap?`, a: `${lead.name} (${lead.symbol}), with a market cap of ${formatUsd(lead.marketCap)} as of ${asOf(at)}.` });
    faq.push({ q: `How big is the ${cat.label.toLowerCase()} market?`, a: `The ${coins.length} ${cat.label.toLowerCase()} tracked here are worth ${formatUsd(cap)} combined, with ${formatUsd(vol)} in 24-hour volume.` });
  }
  if (g) summary.push(`Total crypto market cap is ${formatUsd(g.totalMarketCap)} (${pct(g.marketCapChange24h)} in 24h); bitcoin dominance is ${g.btcDominance?.toFixed(1) ?? "—"}%.`);
  if (t.kind === "ranking" && top[0]) {
    faq.push({ q: t.queries[0].replace(/^\w/, (s) => s.toUpperCase()) + "?", a: `${list(top.map((c) => `${c.name} (${val(c)})`))} — measured over ${window} as of ${asOf(at)}.` });
  }
  faq.push({ q: "Where does this data come from?", a: "Prices and 24h change come from Binance spot markets where listed; market cap, supply, 1h/7d change and reported volume come from CoinLore. Pages refresh every few minutes." });
  const facts = [...summary, ...coins.slice(0, 10).map((c, i) => `#${i + 1} ${c.name} (${c.symbol}): price ${formatPrice(c.price)}, 24h ${pct(c.change24h)}, 7d ${pct(c.change7d)}, market cap ${formatUsd(c.marketCap)}, volume ${formatUsd(c.volume24h)}`)];
  return { summary, faq, facts };
}

function dexCopy(t: Topic, pools: Pool[], at: number) {
  const summary: string[] = [];
  const faq: Faq[] = [];
  if (!pools.length) summary.push("On-chain pool data is temporarily unavailable. Please check back shortly.");
  else {
    const byVol = [...pools].sort((a, b) => (b.volume.h24 ?? 0) - (a.volume.h24 ?? 0));
    const lead = byVol[0];
    const nets = new Set(pools.map((p) => p.network));
    const total = pools.reduce((s, p) => s + (p.volume.h24 ?? 0), 0);
    summary.push(`As of ${asOf(at)}, ${pools.length} tokens are listed${nets.size > 1 ? ` across ${nets.size} networks` : ""}, with ${formatUsd(total)} in combined 24h DEX volume.`);
    summary.push(`${lead.base.name} (${lead.base.symbol}) leads by volume with ${formatUsd(lead.volume.h24)} traded on ${lead.dex}${lead.change.h24 !== null ? `, ${pct(lead.change.h24)} over 24h` : ""}.`);
    const movers = [...pools].filter((p) => p.change.h24 !== null && (p.reserveUsd ?? 0) > 50_000).sort((a, b) => (b.change.h24 ?? 0) - (a.change.h24 ?? 0));
    if (movers[0]) summary.push(`Biggest 24h move among pools with over $50K liquidity: ${movers[0].base.symbol} at ${pct(movers[0].change.h24)}.`);
    faq.push({ q: `${t.queries[0].replace(/^\w/, (s) => s.toUpperCase())}?`, a: `${list(byVol.slice(0, 3).map((p) => `${p.base.symbol} (${formatUsd(p.volume.h24)} 24h volume)`))}, as of ${asOf(at)}.` });
  }
  faq.push({ q: "Are these tokens safe to trade?", a: "Listing here only means the pool exists on-chain. Open a token to see liquidity, holder concentration and contract risk checks before trading, and never trade more than you can afford to lose." });
  const facts = [...summary, ...pools.slice(0, 10).map((p, i) => `#${i + 1} ${p.base.name} (${p.base.symbol}) on ${p.network}: price ${formatPrice(p.priceUsd)}, 24h ${pct(p.change.h24)}, volume ${formatUsd(p.volume.h24)}, liquidity ${formatUsd(p.reserveUsd)}`)];
  return { summary, faq, facts };
}

function relatedTopics(t: Topic): RelatedLink[] {
  return TOPICS.filter((x) => x.slug !== t.slug && (x.kind === t.kind || x.kind === "ranking")).slice(0, 10).map((x) => ({ label: x.label, href: `/markets/${x.slug}` }));
}

/* ------------------------------------------------------------ comparisons */

export interface Perf { d7: number | null; d30: number | null; d90: number | null; vol30: number | null; vol90: number | null; closes: number[] }
export interface ComparePage {
  a: CoinMarket; b: CoinMarket; pa: Perf; pb: Perf;
  corr90: number | null; fetchedAt: number;
  summary: string[]; intro: string | null; faq: Faq[]; related: RelatedLink[];
}

async function perf(symbol: string, pairs: Record<string, string>): Promise<Perf> {
  const none: Perf = { d7: null, d30: null, d90: null, vol30: null, vol90: null, closes: [] };
  const pair = pairs[symbol.toUpperCase()];
  if (!pair) return none;
  try {
    const closes = (await getKlines(pair, "1d", 91)).data.map((c) => c.close);
    const ch = (n: number) => (closes.length > n ? (closes[closes.length - 1] / closes[closes.length - 1 - n] - 1) * 100 : null);
    return { d7: ch(7), d30: ch(30), d90: ch(90), vol30: volatility(closes.slice(-31)), vol90: volatility(closes), closes };
  } catch { return none; }
}

export async function comparePage(aId: string, bId: string): Promise<ComparePage | null> {
  const env = await getMarkets({ ids: [aId, bId] });
  const a = env.data.find((c) => c.id === aId), b = env.data.find((c) => c.id === bId);
  if (!a || !b) return null;
  let pairs: Record<string, string> = {};
  try { pairs = (await getUsdtSymbols()).data; } catch { /* performance becomes unavailable */ }
  // A Binance pair only counts when it passed the price-agreement check (high24h set).
  const [pa, pb] = await Promise.all([a.high24h !== null ? perf(a.symbol, pairs) : perf("", {}), b.high24h !== null ? perf(b.symbol, pairs) : perf("", {})]);
  const corr90 = correlation(pa.closes, pb.closes);
  const at = env.fetchedAt;
  const summary: string[] = [];
  const faq: Faq[] = [];
  const [big, small] = (a.marketCap ?? 0) >= (b.marketCap ?? 0) ? [a, b] : [b, a];

  if (big.marketCap && small.marketCap) {
    summary.push(`${big.name} (${big.symbol}) has a market cap of ${formatUsd(big.marketCap)}, ${(big.marketCap / small.marketCap).toFixed(1)}× that of ${small.name} (${small.symbol}) at ${formatUsd(small.marketCap)}, as of ${asOf(at)}.`);
    if (small.circulatingSupply) {
      const implied = big.marketCap / small.circulatingSupply;
      summary.push(`At ${big.name}'s market cap, one ${small.symbol} would be worth ${formatPrice(implied)} — ${(implied / (small.price ?? implied)).toFixed(1)}× its current price of ${formatPrice(small.price)}. This is arithmetic, not a forecast.`);
      faq.push({ q: `What would ${small.symbol} be worth with ${big.symbol}'s market cap?`, a: `${formatPrice(implied)} per ${small.symbol}, based on ${small.name}'s current circulating supply. This is arithmetic, not a forecast.` });
    }
    faq.push({ q: `Is ${big.name} bigger than ${small.name}?`, a: `Yes. ${big.name}'s market cap is ${formatUsd(big.marketCap)} versus ${formatUsd(small.marketCap)} for ${small.name} (${asOf(at)}).` });
  }
  if (a.change24h !== null && b.change24h !== null) summary.push(`Over 24 hours ${a.symbol} is ${pct(a.change24h)} and ${b.symbol} is ${pct(b.change24h)}.`);
  for (const [k, label] of [["d30", "30 days"], ["d90", "90 days"]] as const) {
    if (pa[k] !== null && pb[k] !== null) {
      const [w, l] = pa[k]! >= pb[k]! ? [[a, pa[k]!], [b, pb[k]!]] as const : [[b, pb[k]!], [a, pa[k]!]] as const;
      summary.push(`Over ${label}, ${w[0].symbol} ${w[1] >= 0 ? "gained" : "lost"} ${abs(w[1])} while ${l[0].symbol} ${l[1] >= 0 ? "gained" : "lost"} ${abs(l[1])}.`);
      if (k === "d30") faq.push({ q: `Which performed better over the last 30 days, ${a.symbol} or ${b.symbol}?`, a: `${w[0].name}: ${pct(w[1])} vs ${l[0].name}: ${pct(l[1])} (Binance daily closes, ${asOf(at)}).` });
    }
  }
  if (pa.vol90 !== null && pb.vol90 !== null) summary.push(`Annualised 90-day volatility: ${a.symbol} ${pa.vol90.toFixed(0)}%, ${b.symbol} ${pb.vol90.toFixed(0)}% — ${pa.vol90 > pb.vol90 ? a.symbol : b.symbol} has been the more volatile asset.`);
  if (corr90 !== null) {
    const word = corr90 > 0.75 ? "strongly" : corr90 > 0.4 ? "moderately" : corr90 > 0.1 ? "weakly" : "barely";
    summary.push(`Their daily returns are ${word} correlated over 90 days (${corr90.toFixed(2)}).`);
    faq.push({ q: `Do ${a.symbol} and ${b.symbol} move together?`, a: `Their 90-day correlation of daily returns is ${corr90.toFixed(2)} (1 = move in lockstep, 0 = unrelated) — ${word} correlated.` });
  }
  faq.push({ q: "Where does this data come from?", a: "Live prices and history from Binance spot markets; market cap and supply from CoinLore. Past performance doesn't predict future returns." });
  const facts = [
    ...summary,
    `${a.name} (${a.symbol}): price ${formatPrice(a.price)}, 24h ${pct(a.change24h)}, 7d ${pct(a.change7d)}, market cap ${formatUsd(a.marketCap)}, volume ${formatUsd(a.volume24h)}`,
    `${b.name} (${b.symbol}): price ${formatPrice(b.price)}, 24h ${pct(b.change24h)}, 7d ${pct(b.change7d)}, market cap ${formatUsd(b.marketCap)}, volume ${formatUsd(b.volume24h)}`,
  ];
  const related: RelatedLink[] = [
    ...categoriesOf(a).concat(categoriesOf(b)).filter((c, i, arr) => arr.findIndex((x) => x.slug === c.slug) === i).map((c) => ({ label: c.label, href: `/markets/${c.slug}` })),
    { label: `${a.name} price`, href: `/coin/${a.id}` }, { label: `${b.name} price`, href: `/coin/${b.id}` },
  ];
  return { a, b, pa, pb, corr90, fetchedAt: at, summary, intro: aiIntro(`c:${pairSlug(a.id, b.id)}`, `${a.name} vs ${b.name}`, facts), faq, related };
}

/** Other comparisons that include this coin (for internal links). */
export function comparisonsFor(id: string, coins: CoinMarket[], limit = 6): RelatedLink[] {
  return comparePairs(coins).filter(([x, y]) => x.id === id || y.id === id).slice(0, limit)
    .map(([x, y]) => ({ label: `${x.symbol} vs ${y.symbol}`, href: `/compare/${pairSlug(x.id, y.id)}` }));
}

/* ----------------------------------------------------------- coin pages */

/** Server-rendered, data-only copy for a coin page (price queries). */
export function coinPageCopy(c: CoinMarket, at: number): { summary: string[]; faq: Faq[] } {
  const summary: string[] = [];
  const faq: Faq[] = [];
  summary.push(`The live ${c.name} price is ${formatPrice(c.price)}${c.change24h !== null ? `, ${c.change24h >= 0 ? "up" : "down"} ${abs(c.change24h)} in the last 24 hours` : ""}${c.rank ? `. ${c.name} ranks #${c.rank} by market cap` : ""} at ${formatUsd(c.marketCap)}, with ${formatUsd(c.volume24h)} traded across exchanges in 24 hours (${asOf(at)}).`);
  if (c.circulatingSupply) summary.push(`${formatNumberPlain(c.circulatingSupply)} ${c.symbol} are in circulation${c.maxSupply ? ` out of a maximum supply of ${formatNumberPlain(c.maxSupply)}` : ", with no fixed maximum supply"}.`);
  if (c.change7d !== null) summary.push(`Over 7 days ${c.symbol} is ${pct(c.change7d)}.`);
  faq.push({ q: `What is the price of ${c.name} today?`, a: `${formatPrice(c.price)} per ${c.symbol} as of ${asOf(at)}, ${pct(c.change24h)} over 24 hours.` });
  if (c.marketCap) faq.push({ q: `What is ${c.name}'s market cap?`, a: `${formatUsd(c.marketCap)} — its price multiplied by the ${formatNumberPlain(c.circulatingSupply)} ${c.symbol} in circulation.` });
  faq.push({ q: `How do I buy ${c.name}?`, a: `Open Trade on this page to see a live quote with every fee shown up front, then approve the swap in your own wallet. Bajar never holds your funds or keys.` });
  return { summary, faq };
}
const formatNumberPlain = (v: number | null) => (v === null ? "—" : Math.round(v).toLocaleString("en-US"));

/* --------------------------------------------- trending searches (links) */

export async function trendingSearches(limit = 14): Promise<RelatedLink[]> {
  try {
    const { coins } = await universe();
    const liquid = coins.filter((c) => (c.volume24h ?? 0) > 5e6);
    const movers = [...liquid].sort((x, y) => Math.abs(y.change24h ?? 0) - Math.abs(x.change24h ?? 0)).slice(0, 4);
    const traded = [...liquid].sort((x, y) => (y.volume24h ?? 0) - (x.volume24h ?? 0)).slice(0, 3);
    const pairs = comparePairs(coins).sort(([a1, b1], [a2, b2]) => (a2.volume24h ?? 0) + (b2.volume24h ?? 0) - (a1.volume24h ?? 0) - (b1.volume24h ?? 0)).slice(0, 4);
    const out: RelatedLink[] = [
      ...[...traded, ...movers].filter((c, i, a) => a.indexOf(c) === i).map((c) => ({ label: `${c.name} price`, href: `/coin/${c.id}` })),
      ...pairs.map(([x, y]) => ({ label: `${x.symbol} vs ${y.symbol}`, href: `/compare/${pairSlug(x.id, y.id)}` })),
      { label: "Top gainers today", href: "/markets/top-gainers" },
      { label: "Trending tokens", href: "/markets/trending-tokens" },
      { label: "Meme coins", href: "/markets/memecoins" },
    ];
    return out.slice(0, limit);
  } catch {
    return [{ label: "Top gainers today", href: "/markets/top-gainers" }, { label: "Trending tokens", href: "/markets/trending-tokens" }];
  }
}

/* -------------------------------------------------------------- the plan */

export interface PlanEntry { path: string; priority: number; changeFrequency: "always" | "hourly" | "daily" | "weekly"; lastModified: Date }

/** Every public page worth indexing right now, with priorities. */
export async function seoPlan(): Promise<PlanEntry[]> {
  const now = new Date();
  const e = (path: string, priority: number, changeFrequency: PlanEntry["changeFrequency"] = "hourly"): PlanEntry => ({ path, priority, changeFrequency, lastModified: now });
  const out: PlanEntry[] = [e("/", 1), e("/tokens", 0.95), e("/discover", 0.9), e("/markets", 0.9), e("/trade", 0.7), e("/launchpad", 0.7), e("/intelligence", 0.6)];
  out.push(...TOPICS.map((t) => e(`/markets/${t.slug}`, t.kind === "ranking" ? 0.85 : 0.75)));
  try {
    const { coins } = await universe();
    out.push(...coins.map((c) => e(`/coin/${c.id}`, c.rank && c.rank <= 50 ? 0.8 : c.rank && c.rank <= 150 ? 0.65 : 0.5)));
    out.push(...comparePairs(coins).map(([a, b]) => e(`/compare/${pairSlug(a.id, b.id)}`, 0.55, "daily")));
  } catch (err) { log("warn", "seo plan: market universe unavailable", { error: String(err) }); }
  try {
    const trending = await getTrendingPools();
    const seen = new Set<string>();
    for (const p of trending.data) {
      const path = `/token/${p.network}/${p.base.address}`;
      if (p.base.address && !seen.has(path) && (p.reserveUsd ?? 0) > 100_000) { seen.add(path); out.push(e(path, 0.5)); }
    }
  } catch { /* DEX feed optional */ }
  return out;
}

/* ------------------------------------------------- optional AI intro text */

const g = globalThis as unknown as { __seoIntro?: Map<string, { at: number; text: string | null }>; __seoBusy?: Set<string>; __seoBudget?: { hour: number; n: number } };
const intros = (g.__seoIntro ??= new Map());
const busy = (g.__seoBusy ??= new Set());
const INTRO_TTL = 6 * 3600_000;
const MAX_PER_HOUR = 40;

/** Numbers in a text, normalised (1,234.5 → 1234.5). */
export const numbersIn = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.0+$/, ""));

/** True if every number in `text` also appears in `facts` (no invented figures). */
export function groundedIn(text: string, facts: string): boolean {
  const allowed = new Set(numbersIn(facts));
  return numbersIn(text).every((n) => allowed.has(n));
}

/**
 * Cached AI-written intro for a page, or null. Generation runs after the
 * response so pages never wait on it; the deterministic summary always renders.
 */
export function aiIntro(key: string, title: string, facts: string[]): string | null {
  if (!aiConfigured()) return null;
  const hit = intros.get(key);
  if (hit && Date.now() - hit.at < INTRO_TTL) return hit.text;
  const hour = Math.floor(Date.now() / 3600_000);
  const budget = (g.__seoBudget ??= { hour, n: 0 });
  if (budget.hour !== hour) Object.assign(budget, { hour, n: 0 });
  if (busy.has(key) || budget.n >= MAX_PER_HOUR) return hit?.text ?? null;
  busy.add(key);
  budget.n++;
  const job = () => writeIntro(title, facts)
    .then((text) => { intros.set(key, { at: Date.now(), text }); })
    .catch((err) => { log("warn", "seo intro failed", { key, error: String(err) }); intros.set(key, { at: Date.now() - INTRO_TTL + 600_000, text: hit?.text ?? null }); })
    .finally(() => busy.delete(key));
  try { after(job); } catch { void job(); }
  return hit?.text ?? null;
}

const SYSTEM = `You write the opening paragraph for a crypto market data page on Bajar.
Rules:
- 2 to 3 sentences, plain English, neutral and factual, under 80 words.
- Use ONLY the facts provided. Every number you write must appear exactly as given in the facts. If unsure, leave the number out.
- No predictions, price targets, advice, hype, or calls to buy/sell. No emojis, no markdown, no headings.
- Write naturally for someone who searched for this topic; mention the topic name once.
Output only the paragraph.`;

async function writeIntro(title: string, facts: string[]): Promise<string | null> {
  const factText = facts.join("\n");
  const client = new Anthropic();
  const res = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: [{ role: "user", content: `Topic: ${title}\n\nFacts:\n${factText}` }],
  });
  if (res.stop_reason !== "end_turn") return null;
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").replace(/\s+/g, " ").trim();
  if (!text || text.length > 700) return null;
  // Reject anything with a figure that isn't in the data.
  return groundedIn(text, `${factText} ${title}`) ? text : null;
}

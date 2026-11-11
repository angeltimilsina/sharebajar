import "server-only";
import type { AgentEvent, AgentId, Offer } from "./types";
import { retailerById } from "./registry";
import { parseProductLink } from "./url";
import { productFromLink, searchCatalog } from "./catalog";
import { cryptoQuote, PAY_ASSETS, type PayAsset } from "./cryptoQuote";
import { SANDBOX_SHIPPING } from "./providers/sandbox";
import { checkoutModeFor, ordersFor, type OrderView } from "./orders";

/**
 * BAJAR Agents orchestrator. Each hashtag agent is a worker with a scoped
 * job and its own tools; they run in parallel where they don't depend on each
 * other, and report progress, evidence and a confidence score. Agents only
 * report what their sources returned — nothing is invented, and no agent can
 * pay: #Checkout prepares a purchase the user must authorize.
 */
export type Emit = (e: AgentEvent | { type: "products"; items: Offer[] } | { type: "best"; id: string | null; reason: string } | { type: "checkout"; offer: Offer; mode: "bajar_pay_sandbox" | "bajar_pay" | "external" } | { type: "orders"; items: OrderView[] } | { type: "context"; query: string; budget: number | null; asset: PayAsset; link: string | null }) => void;

export interface RunInput { message: string; agents?: AgentId[]; sandbox?: boolean; wallet?: string | null; orderTokens?: string[]; account?: { hasProfile: boolean; country: string | null; stores: { store: string; accountName: string | null }[] } }
export interface RunResult { query: string; budget: number | null; asset: PayAsset; offers: Offer[]; best: Offer | null; notes: Record<string, string[]> }

const TAGS: Record<string, AgentId> = { find: "find", deals: "deals", compare: "compare", verify: "verify", shipping: "shipping", budget: "budget", crypto: "crypto", checkout: "checkout", track: "track" };

export function parseRequest(message: string, agents?: AgentId[]) {
  const tags = [...message.matchAll(/#(\w+)/g)].map((m) => TAGS[m[1].toLowerCase()]).filter(Boolean) as AgentId[];
  const link = /https:\/\/\S+/.exec(message)?.[0] ?? null;
  const budgetM = /(?:under|below|less than|max(?:imum)?|budget(?: of)?|up to|<)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/i.exec(message) ?? /\$\s*([\d,]+(?:\.\d+)?)(k)?\b/.exec(message);
  const budget = budgetM ? Number(budgetM[1].replace(/,/g, "")) * (budgetM[2] ? 1000 : 1) : null;
  const asset = (["USDC", "USDT", "ETH", "SOL", "BTC"] as PayAsset[]).find((a) => new RegExp(`\\b${a}\\b`, "i").test(message)) ?? "USDC";
  const query = message
    .replace(/https:\/\/\S+/g, " ").replace(/#\w+/g, " ")
    .replace(/(?:under|below|less than|max(?:imum)?|budget(?: of)?|up to|<)\s*\$?\s*[\d,]+(?:\.\d+)?k?/gi, " ").replace(/\$\s*[\d,]+(?:\.\d+)?k?/g, " ")
    .replace(/\b(find|me|the|best|a|an|for|and|with|pay|let|compare|offers?|deals?|cheapest|please|show|get|buy|i want|looking for|using|via|in)\b/gi, " ")
    .replace(/\b(USDC|USDT|ETH|SOL|BTC)\b/gi, " ").replace(/[^\w\s.-]/g, " ").replace(/\s+/g, " ").trim();
  let chosen: AgentId[] = agents?.length ? agents : tags;
  if (!chosen.length) chosen = ["find", "deals", "compare", "verify", "shipping", "crypto", "checkout", ...(budget ? ["budget" as AgentId] : [])];
  if (!chosen.includes("find") && chosen.some((a) => a !== "track")) chosen = ["find", ...chosen];
  return { tags: chosen, link, budget, asset, query };
}

const total = (o: Offer) => (o.price === null ? null : o.price + (o.shipping ?? 0) + (o.tax ?? 0));
const pct = (o: Offer) => (o.compareAtPrice && o.price ? (1 - o.price / o.compareAtPrice) * 100 : 0);

export async function runAgents(input: RunInput, emit: Emit): Promise<RunResult> {
  const req = parseRequest(input.message, input.agents);
  const on = (a: AgentId) => req.tags.includes(a);
  const notes: Record<string, string[]> = {};
  const done = (agent: AgentId, label: string, findings: string[], confidence: number, tool?: string) => { notes[agent] = findings; emit({ type: "agent", agent, status: "done", label, findings, confidence, tool }); };
  emit({ type: "context", query: req.query, budget: req.budget, asset: req.asset, link: req.link });

  const trackP = on("track") ? (async () => {
    emit({ type: "agent", agent: "track", status: "working", label: "Looking up your orders", tool: "orders" });
    if (!input.wallet && !input.orderTokens?.length) { done("track", "No orders on this device", ["Sign in with your wallet to see orders placed elsewhere."], 1); return; }
    const items = await ordersFor({ wallet: input.wallet, tokens: input.orderTokens }).catch(() => []);
    emit({ type: "orders", items });
    done("track", items.length ? `${items.length} order${items.length === 1 ? "" : "s"} found` : "No orders yet", items.slice(0, 5).map((o) => `${o.title} — ${o.status}${o.sandbox ? " (sandbox)" : ""}`), 1, "orders");
  })() : null;

  // #Find (or the pasted link) first: the other agents work on its results.
  let offers: Offer[] = [];
  if (on("find")) {
    if (req.link) {
      emit({ type: "agent", agent: "find", status: "working", label: "Reading the product link", tool: "link_parser" });
      const p = parseProductLink(req.link);
      const r = await productFromLink(req.link);
      if (r.offer) offers = [r.offer];
      const facts = [`Store: ${retailerById(r.retailer).name}${p.productId ? ` · id ${p.productId}` : ""}`, ...(r.blocked ? [r.blocked] : []), ...(r.note ? [r.note] : []), ...r.warnings];
      if (r.offer) facts.unshift(`${r.offer.title} — ${r.offer.price !== null ? `$${r.offer.price.toFixed(2)}` : "price not published"} (${r.offer.source})`);
      done("find", r.offer ? "Identified the product" : r.blocked ? "Link blocked" : "Couldn't read live data for this link", facts, r.offer ? 0.95 : 0.3, "link_parser");
      // Look for the same product elsewhere to compare.
      if (r.offer && req.query.length < 3) req.query = r.offer.title.split(/[,(|–-]/)[0].slice(0, 60);
    }
    if (req.query.length >= 2) {
      emit({ type: "agent", agent: "find", status: "working", label: `Searching supported retailers for "${req.query}"`, tool: "catalog_search" });
      const s = await searchCatalog(req.query, { maxPrice: req.budget ?? undefined, sandbox: input.sandbox });
      offers = [...offers, ...s.offers.filter((o) => !offers.some((x) => x.url === o.url))];
      const okSources = s.runs.filter((r) => r.ok).length;
      const stores = new Set(offers.map((o) => o.merchant)).size;
      done("find", `${offers.length} offer${offers.length === 1 ? "" : "s"} from ${stores} store${stores === 1 ? "" : "s"}`,
        [...s.runs.filter((r) => r.count).map((r) => `${r.source}: ${r.count}`), ...s.runs.filter((r) => !r.ok).slice(0, 3).map((r) => `${r.source}: unavailable right now`), ...(offers.length ? [] : ["No matching products from the connected sources."])],
        s.runs.length ? okSources / s.runs.length : 0, "catalog_search");
    }
    emit({ type: "products", items: offers.slice(0, 24) });
  }

  const priced = offers.filter((o) => o.price !== null);
  const best = [...priced].sort((a, b) => (total(a)! - total(b)!) || (b.inStock ? 1 : 0) - (a.inStock ? 1 : 0)).find((o) => o.inStock !== false) ?? null;

  await Promise.all([
    on("deals") && (async () => {
      emit({ type: "agent", agent: "deals", status: "working", label: "Checking merchant discounts", tool: "price_compare" });
      const d = priced.filter((o) => pct(o) >= 1).sort((a, b) => pct(b) - pct(a));
      done("deals", d.length ? `${d.length} discounted offer${d.length === 1 ? "" : "s"}` : "No merchant discounts found",
        d.slice(0, 5).map((o) => `${o.title.slice(0, 50)}: $${o.price!.toFixed(2)} (was $${o.compareAtPrice!.toFixed(2)}, −${pct(o).toFixed(0)}%) at ${o.merchant}`), d.length ? 0.9 : 0.7, "price_compare");
    })(),
    on("compare") && (async () => {
      emit({ type: "agent", agent: "compare", status: "working", label: "Ranking by total price and availability", tool: "rank_offers" });
      const ranked = [...priced].sort((a, b) => total(a)! - total(b)!);
      emit({ type: "best", id: best?.id ?? null, reason: best ? `Lowest known total among in-stock offers ($${total(best)!.toFixed(2)}${best.shipping === null ? " + shipping at checkout" : ""}).` : "No priced, in-stock offer." });
      done("compare", best ? `Best total: $${total(best)!.toFixed(2)} at ${best.merchant}` : "Nothing to compare", ranked.slice(0, 5).map((o, i) => `${i + 1}. $${total(o)!.toFixed(2)}${o.shipping === null ? "*" : ""} — ${o.title.slice(0, 48)} (${o.merchant}${o.inStock === false ? ", out of stock" : ""})`).concat(ranked.some((o) => o.shipping === null) ? ["* shipping/tax added by the merchant at checkout"] : []), priced.length >= 2 ? 0.85 : priced.length ? 0.6 : 0.2, "rank_offers");
    })(),
    on("verify") && (async () => {
      emit({ type: "agent", agent: "verify", status: "working", label: "Checking merchants", tool: "merchant_registry" });
      const merchants = [...new Map(offers.map((o) => [o.merchantDomain, o])).values()];
      const f = merchants.map((o) => {
        const r = retailerById(o.retailer);
        const known = o.retailer !== "web";
        return `${o.merchant}: ${known ? "recognized store" : "unrecognized store — verify before buying"} · https · ${r.checkout === "external" ? "checkout on merchant site" : r.checkout === "bajar_pay_sandbox" ? "BAJAR Pay (sandbox)" : "BAJAR Pay"}`;
      });
      done("verify", merchants.length ? `${merchants.filter((o) => o.retailer !== "web").length} of ${merchants.length} merchants recognized` : "No merchants to verify", f.slice(0, 8), merchants.length ? merchants.filter((o) => o.retailer !== "web").length / merchants.length : 0.5, "merchant_registry");
    })(),
    on("shipping") && (async () => {
      emit({ type: "agent", agent: "shipping", status: "working", label: "Collecting delivery options", tool: "shipping_options" });
      const f = (best ? [best] : priced.slice(0, 3)).map((o) => o.sandbox ? `${o.merchant}: ${SANDBOX_SHIPPING.map((s) => `${s.label} $${s.usd}`).join(", ")}` : o.shipping !== null ? `${o.merchant}: shipping $${o.shipping.toFixed(2)}` : `${o.merchant}: delivery options and dates are shown on the merchant's checkout (not published in its product data)`);
      done("shipping", "Delivery info", f, best?.sandbox || best?.shipping !== null ? 0.9 : 0.4, "shipping_options");
    })(),
    on("budget") && (async () => {
      emit({ type: "agent", agent: "budget", status: "working", label: req.budget ? `Fitting picks under $${req.budget}` : "No budget given", tool: "budget_filter" });
      if (!req.budget) { done("budget", "Add a budget, e.g. \"under $500\"", [], 1); return; }
      const within = priced.filter((o) => total(o)! <= req.budget!).sort((a, b) => total(b)! - total(a)!);
      done("budget", `${within.length} offer${within.length === 1 ? "" : "s"} within $${req.budget}`, within.slice(0, 4).map((o) => `$${total(o)!.toFixed(2)} — ${o.title.slice(0, 50)} (${o.merchant}), leaves $${(req.budget! - total(o)!).toFixed(2)}`), 0.9, "budget_filter");
    })(),
  ].filter(Boolean));

  await Promise.all([
    on("crypto") && (async () => {
      emit({ type: "agent", agent: "crypto", status: "working", label: `Converting to ${req.asset}`, tool: "crypto_quote" });
      if (!best) { done("crypto", "Nothing to price yet", [], 0.5); return; }
      try {
        const nets = PAY_ASSETS[req.asset].networks;
        const quotes = await Promise.all(nets.map((n) => cryptoQuote(total(best)!, req.asset, n)));
        done("crypto", `${quotes[0].amount} ${req.asset} for the best offer`, quotes.map((q) => `${q.amount} ${q.asset} on ${q.network} + ≈$${q.networkFeeUsd} network fee (price ${q.priceSource})`), 0.9, "crypto_quote");
      } catch (e) { done("crypto", "Price unavailable", [String((e as Error).message)], 0.2, "crypto_quote"); }
    })(),
    on("checkout") && (async () => {
      emit({ type: "agent", agent: "checkout", status: "working", label: "Checking how this can be bought", tool: "checkout_capability" });
      if (!best) { done("checkout", "No offer selected", [], 0.5); return; }
      const mode = checkoutModeFor(best);
      emit({ type: "checkout", offer: best, mode });
      done("checkout", mode === "external" ? `Checkout on ${best.merchant}'s site` : mode === "bajar_pay_sandbox" ? "Ready for BAJAR Pay (sandbox)" : "Ready for BAJAR Pay",
        [
          ...(mode === "external" ? [`${best.merchant} doesn't support BAJAR checkout yet. Open the product on the merchant's site to buy.`] : ["Review the order, then authorize the payment yourself in your wallet. Agents can't pay."]),
          ...(input.account?.hasProfile
            ? [mode !== "external" ? "Your saved name and address will be filled in." : best.retailer === "shopify" ? "Your saved details can be filled into the store's checkout (you confirm first)." : "Copy your saved details from your profile into the store's checkout."]
            : ["Save your name and address in your shopping profile to skip typing them."]),
          ...(input.account?.stores ?? []).filter((x) => x.store === best.retailer).map((x) => `Signed in to ${x.store === "ebay" ? "eBay" : "Amazon"}${x.accountName ? ` as ${x.accountName}` : ""}.`),
        ], 0.95, "checkout_capability");
    })(),
  ].filter(Boolean));

  await trackP;
  return { query: req.query, budget: req.budget, asset: req.asset, offers, best, notes };
}

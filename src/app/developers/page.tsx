import type { Metadata } from "next";
import Link from "next/link";
import { CHAINS } from "@bajar/chain-adapters";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Developers — BAJAR market-data API",
  description: "Free, real-time token and liquidity-pool data for Solana, Base, Arbitrum, Ethereum and BNB Chain: search, trending, new pools, token profiles, risk, candles, trades and live streams. OpenAPI 3.1.",
  alternates: { canonical: "/developers" },
};

const SOL_POOL = "{pool}";
const ENDPOINTS: { method: string; path: string; what: string; example: string }[] = [
  { method: "GET", path: "/api/v1/chains", what: "Supported chains and rollout phase", example: "/api/v1/chains" },
  { method: "GET", path: "/api/v1/search?q=", what: "Search by name, symbol or contract address", example: "/api/v1/search?q=bonk" },
  { method: "GET", path: "/api/v1/tokens/trending?chain=&window=", what: "Trending pools (5m, 1h, 6h, 24h)", example: "/api/v1/tokens/trending?chain=solana&window=1h" },
  { method: "GET", path: "/api/v1/tokens/new?chain=", what: "Newly created pools", example: "/api/v1/tokens/new?chain=base" },
  { method: "GET", path: "/api/v1/tokens/top?chain=", what: "Top pools by 24h volume", example: "/api/v1/tokens/top?chain=solana" },
  { method: "GET", path: "/api/v1/tokens/{chain}/{address}", what: "Token profile: price, market cap, FDV, liquidity, volume, holders", example: "/api/v1/tokens/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { method: "GET", path: "/api/v1/tokens/{chain}/{address}/pools", what: "A token’s pools, deepest first", example: "/api/v1/tokens/base/0x532f27101965dd16442e59d40670faf5ebb142e4/pools" },
  { method: "GET", path: "/api/v1/tokens/{chain}/{address}/risk", what: "Risk: honeypot, taxes, permissions, holder concentration, locked liquidity", example: "/api/v1/tokens/base/0x532f27101965dd16442e59d40670faf5ebb142e4/risk" },
  { method: "GET", path: "/api/v1/pools/{chain}/{address}", what: "Pool price, liquidity, volume and transactions", example: `/api/v1/pools/solana/${SOL_POOL}` },
  { method: "GET", path: "/api/v1/pools/{chain}/{address}/ohlcv?tf=", what: "Candles: 1m, 5m, 15m, 1h, 4h, 1d", example: `/api/v1/pools/solana/${SOL_POOL}/ohlcv?tf=15m` },
  { method: "GET", path: "/api/v1/pools/{chain}/{address}/trades", what: "Latest swaps", example: `/api/v1/pools/solana/${SOL_POOL}/trades` },
  { method: "GET", path: "/api/v1/pools/{chain}/{address}/history?hours=", what: "Indexed snapshots over time (needs the BAJAR indexer)", example: `/api/v1/pools/solana/${SOL_POOL}/history?hours=24` },
  { method: "SSE", path: "/api/v1/stream/pools/{chain}/{address}", what: "Live pool updates and new trades (Server-Sent Events)", example: `/api/v1/stream/pools/solana/${SOL_POOL}` },
];

export default function DevelopersPage() {
  const base = siteUrl();
  return (
    <div className="mx-auto max-w-[960px] px-1 sm:px-2 pb-24 pt-4 space-y-8">
      <header className="space-y-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-brand">Developers</p>
        <h1 className="text-[34px] sm:text-[44px] font-semibold tracking-tight leading-[1.08]">BAJAR market-data API</h1>
        <p className="text-[16px] text-muted max-w-2xl">Real-time token and liquidity-pool data across {CHAINS.map((c) => c.name).join(", ")}. Free, read-only, no account. Values a provider doesn’t report are <code>null</code> — never estimated — and when an upstream is down the API says so instead of serving made-up numbers.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href="/api/v1/openapi.json" className="btn-ink h-10 px-4 rounded-full inline-flex items-center text-[14px] font-semibold" data-testid="openapi-link">OpenAPI 3.1 spec</a>
          <Link href="/status" className="h-10 px-4 rounded-full inline-flex items-center text-[14px] font-medium bg-surface-2 hover:bg-surface-3">Data source status</Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Limits", "60 requests/min per IP. 600/min with an API key in the x-api-key header."],
          ["Format", "{ data, meta: { source, fetchedAt, stale } } — every response names its source and age."],
          ["Errors", "400 invalid input · 404 not found · 429 rate limited (Retry-After) · 502/503 upstream unavailable."],
        ].map(([t, b]) => (
          <div key={t} className="rounded-2xl bg-surface border border-line p-4"><div className="text-[14px] font-semibold">{t}</div><p className="mt-1 text-[13.5px] text-muted leading-relaxed">{b}</p></div>
        ))}
      </section>

      <section className="space-y-2" data-testid="endpoints">
        <h2 className="text-[20px] font-semibold">Endpoints</h2>
        <div className="rounded-2xl bg-surface border border-line divide-y divide-[var(--border)] overflow-hidden">
          {ENDPOINTS.map((e) => (
            <div key={e.path} className="p-4 grid gap-1 sm:grid-cols-[64px_minmax(0,1fr)] sm:gap-3">
              <span className={`text-[12px] font-bold num ${e.method === "SSE" ? "text-warn" : "text-brand"}`}>{e.method}</span>
              <div className="min-w-0">
                <code className="text-[13.5px] break-all">{e.path}</code>
                <p className="text-[13px] text-muted">{e.what}</p>
                {!e.example.includes("{pool}") && <a href={e.example} className="text-[12.5px] text-brand break-all hover:underline">Try it →</a>}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[12.5px] text-faint">Pool endpoints take a pool (pair) address: get one from <code>topPool</code> in a token profile or from any list endpoint.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-[20px] font-semibold">Quick start</h2>
        <pre className="rounded-2xl bg-surface-2 p-4 text-[12.5px] overflow-x-auto"><code>{`# Trending Solana pools in the last hour
curl "${base}/api/v1/tokens/trending?chain=solana&window=1h"

# A token profile, then its candles from the deepest pool
curl "${base}/api/v1/tokens/base/0x532f27101965dd16442e59d40670faf5ebb142e4"
curl "${base}/api/v1/pools/base/<topPool>/ohlcv?tf=1h&limit=200"

# Live trades in the browser
const es = new EventSource("${base}/api/v1/stream/pools/solana/<pool>");
es.addEventListener("trades", (e) => console.log(JSON.parse(e.data)));`}</code></pre>
      </section>

      <section className="space-y-2">
        <h2 className="text-[20px] font-semibold">Open source</h2>
        <p className="text-[14px] text-muted">The chain adapters (<code>packages/chain-adapters</code>) and the indexer (<code>services/indexer</code>) are Apache-2.0. Adding a chain is one registry entry. Data comes from GeckoTerminal, DexScreener and GoPlus Security; each response says which.</p>
      </section>
    </div>
  );
}

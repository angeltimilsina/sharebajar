# ShareBajar — The Open Crypto Marketplace

ShareBajar is a real-time, multi-chain crypto marketplace: token discovery, market intelligence, pro charts, non-custodial trading and wallet portfolios in one interface. Everything public works **without an account**.

> **No API keys required for market data.** Prices, market caps and charts come from CoinLore and Binance public data; network conditions are read directly from the blockchains.
>
> **Data honesty policy.** ShareBajar only shows real market data. Every live widget carries a freshness badge (`Live`, `Delayed`, `Stale`, `Unavailable`) with its source and timestamp. When an upstream fails we show the last good value marked *stale* or an explicit error — never simulated prices. Features that aren't integrated yet are labelled as such in the UI.

## Features

| Area | What's included |
| --- | --- |
| **Marketplace** (`/`) | Live ticker (Binance WebSocket), total market cap / volume / DeFi TVL / BTC & ETH dominance, **Network Pulse** (live block height, fees/gas and throughput read directly from Bitcoin, Ethereum, Solana, Base, BNB Chain, Polygon, Arbitrum, Avalanche, Optimism), network filters (a chain shows its real on-chain pools), market table with live price overlay, trending / gainers / losers / new tokens / high volume / watchlist tabs, trending & newly launched pools, news, launchpad. |
| **Discovery** (`/discover`) | Trending (5m/1h/6h/24h), new pools, top volume, latest token profiles, boosted tokens. Filters for liquidity, volume, FDV, age and 24h change. Contract-address lookup. Rule-based activity signals (volume/liquidity spikes, buy/sell pressure, thin liquidity, fresh pools). Solana is the default network. |
| **Charts** (`/charts`, token pages) | TradingView *lightweight-charts* v5. Candles / line / area; **1s, 5s, 15s**, 1m … 1w. Real-time candle formation, zoom/pan/pinch, crosshair legend, fullscreen. MA20/50, EMA21, Bollinger, VWAP, RSI, MACD, volume, **volume profile**, live **large-trade markers**, ShareBajar **Buyer/Seller Ratio** and **Momentum**. Drawing tools (horizontal & trend lines). |
| **Token pages** | `/coin/[id]` for listed coins (CoinLore + Binance price, order book & trades, top exchange markets) and `/token/[chain]/[address]` for any DEX token (DexScreener + GeckoTerminal + GoPlus): price, MC/FDV/supply/liquidity/volume, live swaps feed with large-trade detection, buy/sell activity, pools table, holder concentration, contract risk analysis, related news, AI summary, buy/sell/swap/watch/share. SEO metadata + JSON-LD. |
| **Wallets & trading** (`/trade`, `/portfolio`) | Wallet picker: **BAJAR Wallet (upcoming)**, Phantom, Solflare, Backpack, MetaMask and any EIP-6963 wallet. Wallet sign-in (signed message, server-verified, httpOnly session). Solana swaps via Jupiter: live quotes, slippage settings, price impact, minimum received, route, fee estimate, **transaction simulation**, explicit wallet approval, on-chain status tracking. Portfolio balances, holdings value, recent transactions, watchlist & price alerts. |
| **Intelligence** (`/intelligence`) | Streaming AI assistant (Claude) with tools for market overview, coin data, technical indicators computed from real candles, DEX token analysis (liquidity, holders, security), trending pools with anomaly signals and news. Proposes watchlists/alerts the user confirms. Always-on rule-based unusual-activity feed. |
| **Treasury** (`/admin/treasury`) | Noncustodial revenue: register Solana wallet / Squads / Jupiter referral and EVM wallet / Safe treasuries, wallet-signed dual approvals, fee collection via Jupiter Swap V2 and 0x with disclosure, on-chain indexer + reconciliation, hash-chained ledger, dashboard, CSV exports, unsigned transfer/convert builders (wallet, Safe batch, Squads). See [docs/TREASURY.md](docs/TREASURY.md). |
| **Ops** | `/status` and `/api/health` (integration + upstream health), structured JSON logs, per-IP rate limits, security headers. |

### Not yet available (clearly labelled in the UI)

- **BAJAR Wallet** — upcoming native wallet.
- **Limit orders** — not yet integrated.
- **Token creation** on the Launchpad — preview only, nothing is deployed.
- **ERC-20 balances / EVM tx history** in Portfolio — needs an indexing provider.
- **AI assistant** — requires `ANTHROPIC_API_KEY`; without it the page says so and the rule-based signals still work.

## Architecture

```
src/
  app/                    Next.js App Router pages + API route handlers
    api/market/*          CoinLore + Binance + DefiLlama (overview, coins, coin detail)
    api/networks          live chain stats: mempool.space (BTC) + JSON-RPC (EVM, Solana)
    api/candles           Binance OHLCV (1s pages, 5s/15s aggregation)
    api/binance/*         tickers, depth, USDT symbol map
    api/dex/*             GeckoTerminal pools/OHLCV/trades/info + DexScreener pairs/profiles
    api/security          GoPlus token security → risk report
    api/news, api/search  RSS news, unified search
    api/swap/*            Jupiter tokens, prices, quotes, unsigned tx build
    api/ai/*              Claude streaming chat (NDJSON) + status
    api/auth/*            wallet sign-in (nonce → verify → session)
    api/health            monitoring
  lib/
    market/               provider clients + normalizers (one file per provider)
    analytics/            pure functions: indicators, candle building, signals, insights, filters
    security/             GoPlus client + pure risk scoring
    trading/              Jupiter execution adapter
    wallet/               injected Solana providers, EIP-6963 discovery, Solana RPC helpers
    stream/               shared, reference-counted Binance WebSocket with reconnect + heartbeat
    ai/                   model config, tools, prompt, browser streaming client
    news/                 dependency-free RSS parser + feeds
    server/               fetch wrapper (timeouts, retries, 429 cool-down), stale-while-error cache, auth, rate limit, logging
  components/             UI (ui primitives, chart, market, token, trade, wallet, ai, discover, portfolio)
  hooks/                  polling, live tickers, local stores (watchlist/alerts), clock
tests/unit                Vitest (indicators, candles, signals, risk, RSS, cache, auth, stream reconnect, normalizers)
tests/e2e                 Playwright (homepage, filters, search, theme, charts, wallet, swap quote, mobile, failure states)
```

Each domain (market data, analytics, wallet connectivity, trading execution, AI) is an independent module with its own provider adapters, so a provider can be swapped without touching the UI.

**Real-time strategy.** CEX-listed assets stream over a single multiplexed Binance WebSocket (`kline_1s`, `miniTicker`, `aggTrade`, `depth20@100ms`). 5s/15s candles are aggregated client-side from real 1s klines. DEX tokens poll on-chain swaps every 4s (server-cached and shared across users) and build sub-minute candles from those swaps — the chart states the coverage window. GeckoTerminal sub-minute OHLCV is a paid feature, so we don't fake it.

**Caching & rate limits.** All upstream calls go through `cached()` (TTL + in-flight de-duplication + stale-on-error) and `fetchUpstream()` (timeouts, retries on 5xx, per-host cool-down after HTTP 429 using `Retry-After`). The cache is in-memory per instance; use Redis (or similar) when running multiple instances.

## Data sources

| Provider | Used for | Key needed |
| --- | --- | --- |
| CoinLore | coin rankings, market cap, supply, 1h/7d change, global stats, exchange markets | no |
| mempool.space | Bitcoin block height, fees, mempool | no |
| Public JSON-RPC nodes (publicnode.com, overridable) | Ethereum, Base, BNB Chain, Polygon, Arbitrum, Avalanche, Optimism (block, gas, txs) and Solana (slot, TPS, priority fees) | no |
| Binance public market data (`data-api.binance.vision`, `data-stream.binance.vision`) | live tickers, 1s klines, order books, trades | no |
| DexScreener | DEX pairs, search, token profiles/boosts | no |
| GeckoTerminal | trending/new pools, pool OHLCV, swaps, holder distribution | no |
| GoPlus | contract security checks | no |
| DefiLlama | DeFi TVL | no |
| Jupiter (`lite-api.jup.ag`) | Solana token list, prices, quotes, swap transactions | no |
| CoinDesk / Cointelegraph / Decrypt RSS | news | no |
| Anthropic (Claude) | AI assistant | `ANTHROPIC_API_KEY` |

## Getting started

```bash
npm install
cp .env.example .env.local   # all variables optional
npm run dev                  # http://localhost:3000
```

```bash
npm run typecheck   # TypeScript
npm test            # unit tests (Vitest)
npm run e2e         # end-to-end tests (Playwright; needs network access to the data providers)
npm run build && npm start
```

> Behind an HTTP proxy, Node's built-in `fetch` ignores `HTTPS_PROXY` unless you run with `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21).

### Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) for Vercel deployment and connecting a custom domain.

### Environment variables

See [`.env.example`](.env.example). Highlights:

- `ANTHROPIC_API_KEY` — enables ShareBajar Intelligence (server-side only).
- `RPC_URL_<CHAIN>` — use your own RPC nodes for network stats (optional).
- `NEXT_PUBLIC_SOLANA_RPC_URL` — dedicated Solana RPC for balances, simulation and status (the public endpoint is rate-limited and often blocks browsers).
- `SESSION_SECRET` — HMAC secret for wallet sessions (required in production).
- `NEXT_PUBLIC_SITE_URL` — canonical URL for metadata and sitemap.

## Security

- Never requests seed phrases or private keys. The wallet modal states this explicitly.
- Swaps: the server builds an **unsigned** transaction; it is simulated, then signed only after the user clicks *Confirm in wallet* and approves in their wallet.
- Wallet sign-in signs a human-readable message (no transaction, no fees), verified server-side (ed25519 / secp256k1) and stored in an HMAC-signed httpOnly cookie.
- All API inputs are validated (addresses per chain, symbols, amounts, slippage bounds); AI and swap endpoints are rate-limited per IP.
- Security headers (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`).

More detail on ownership areas and the QA checklist: [docs/ENGINEERING.md](docs/ENGINEERING.md).

*Nothing on ShareBajar is financial advice.*

# Engineering guide

## Ownership areas

| Area | Owns | Key paths |
| --- | --- | --- |
| Software architecture | module boundaries, API envelope contract (`Envelope<T>`), caching/rate-limit policy | `src/lib/types.ts`, `src/lib/server/*` |
| Frontend engineering | design system, pages, responsive layouts, theming | `src/app/*`, `src/components/ui`, `src/app/globals.css` |
| Market data engineering | provider adapters, normalization, freshness | `src/lib/market/*`, `src/app/api/market`, `src/app/api/dex` |
| Chart development | ProChart, candle feeds, indicators | `src/components/chart/*`, `src/lib/analytics/indicators.ts`, `src/lib/analytics/candles.ts` |
| Blockchain integration | wallet adapters, RPC, swap execution | `src/lib/wallet/*`, `src/lib/trading/*`, `src/components/trade/SwapPanel.tsx` |
| Security | wallet auth, input validation, risk scoring, headers | `src/lib/server/auth.ts`, `src/lib/security/*`, `next.config.ts` |
| AI services | assistant tools, prompt, streaming | `src/lib/ai/*`, `src/app/api/ai/*` |
| QA | unit + e2e suites, release checklist | `tests/*` |

## Conventions

- Every backend response is an `Envelope<T>`: `{ data, source, fetchedAt, stale, error? }`. UI freshness badges use `fetchedAt` + expected cadence.
- Provider code lives in `src/lib/<domain>/<provider>.ts`, imports `server-only`, and wraps calls in `cached()`.
- Pure logic (indicators, candles, signals, risk, filters, insights, RSS) has no I/O and is unit-tested.
- Unavailable functionality is disabled with a visible label — never simulated.

## QA checklist

| Check | How |
| --- | --- |
| Market data accuracy & freshness | `/status` upstream table; freshness badges turn *Delayed*/*Stale* when data ages; e2e failure-state test |
| 1-second chart updates & candle formation | `/charts` at `1s`, status shows *Live stream*; unit tests for `rollLatest`, `upsertCandle`, `applyTrade` |
| Token search & network filtering | ⌘K search e2e; network chip e2e; `applyFilters` unit tests |
| Wallet connect/disconnect | injected-provider e2e; manual test with Phantom & MetaMask |
| Trade quotation & simulation | `/trade` quote e2e; manual: review modal shows build → simulate → approve → confirm |
| Order book sync | coin page order book updates ~4×/s from `depth20@100ms` |
| Mobile responsiveness | Playwright `mobile` project (no horizontal overflow) |
| Dark/light theme | theme e2e (toggle + persistence); visual pass on key pages |
| Streaming reconnection | `tests/unit/stream.test.ts` (backoff, resubscribe, heartbeat) |
| API failure recovery | `tests/unit/misc.test.ts` cache stale-on-error; 429 cool-down in `fetchUpstream` |

## Scaling notes

- Replace the in-memory cache and rate limiter with Redis for multi-instance deployments.
- Move DEX trade polling to a server-side worker that fans out over WebSocket/SSE to clients for lower latency at scale.
- Persist historical OHLCV (e.g. TimescaleDB/ClickHouse) by recording the Binance kline stream and DEX swaps; the candle builders in `lib/analytics/candles.ts` are already source-agnostic.

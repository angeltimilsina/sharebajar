# ShareBajar

**The world's markets. One portfolio.**

A responsive global market research and personal portfolio application. This first implementation provides a desktop workspace and mobile bottom navigation, global market catalog, universal asset search, provider-backed quotes and historical charts, watchlists, comparison, a dynamic crypto and CEX directory, and local portfolio tracking. It does not execute trades.

## Run

Requires Python 3.12+ and Node 20+ (Node is used only for tests). There are no application dependencies to install.

```sh
cd /workspace/sharebajar
python server.py --host 0.0.0.0 --port 3000
```

Default binding without `--host` is loopback. For local development, open port 3000 in your browser. No build or bundler is required. Do not expose this development server as a production deployment.

```sh
npm test
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS 'http://127.0.0.1:3000/api/quotes?symbols=AAPL'
```

The health route checks the application server; quote routes independently check provider access. A provider error is not a successful quote check.

## Data architecture

- `catalog.py`: discovery metadata, never market prices. The directory includes representative instruments across all requested regions. Universal search extends discovery to the security provider's supported universe.
- `providers.py`: replaceable Yahoo Finance research adapter and a `CryptoDataProvider` protocol implemented by CoinGecko. No generated prices, scraped pages, or sample-price fallbacks. Quotes retain provider source, timestamp, and available delay metadata. Crypto search and directory are dynamic, not a maintained list of thousands of symbols.
- `server.py`: JSON routes, static frontend, request validation, shared bounded quote worker pool, and short-lived provider cache.
- `static/finance.js`: testable multi-currency valuation with explicit handling of unavailable quotes and rates.
- `static/app.js`: navigation, search, filtering, chart inspection, watchlists, holdings, import/export, comparison, and allocation.

External destinations: `query1.finance.yahoo.com`, `api.coingecko.com`, and `api.frankfurter.dev`. Optional fonts use `fonts.googleapis.com` and `fonts.gstatic.com`. TLS verification stays enabled. Requests may fail because of rate limits, provider policy, regional coverage, or network restrictions. Failed quotes remain unavailable. Frankfurter rates are reference rates, not streaming FX rates, and do not cover every currency (including NPR in the current default feed).

Yahoo's public endpoints are a development/research adapter, not a licensed commercial data entitlement. Production deployment requires an appropriately licensed provider, configured credentials, coverage validation, and provider-specific exchange calendars. Catalog symbols are discovery candidates; their presence is not a coverage guarantee. NEPSE and other unserved regional markets explicitly require a licensed adapter.

CoinGecko's broad asset universe is shown for discovery. Individual asset exchange tables verify up to eight venues through provider exchange-detail responses; unclassified exchanges are omitted. The exchange directory verifies each page of ten entries through the same detail endpoint. Exchange details are cached for an hour to limit classification requests. This is not yet a complete, CEX-only asset universe. The exchange directory itself is paginated and filters to provider-confirmed centralized venues. It makes no safety or solvency claims.

## Portfolio behavior

Multiple named portfolios hold manually recorded positions, including cash. Quantity, purchase price/date, currency, and an optional exchange/wallet are saved in browser localStorage. Export/import provides JSON backups. There is no account, authentication, database, server-side holding storage, or synchronization between devices.

Valuations convert quote and cost-basis currencies into the chosen base currency using current reference FX rates. Holdings with missing prices or FX rates are excluded from subtotals and explicitly counted. Daily change uses price movement at current FX; it excludes the effect of daily FX changes. Missing daily movements produce an unavailable total, rather than zero. Unrealized returns compare present values with recorded cost basis converted at current FX; they are not tax or time-weighted returns. Allocation reports instrument domicile and quote currency, not underlying business revenue exposure.

## Validation and remaining scope

`npm test` runs valuation and provider normalization tests. Browser checks during implementation exercised real unavailable-feed behavior, watchlist persistence, cash recording, reload persistence, allocation, regional coverage messages, responsive layout, and interactive charts/comparison with isolated provider fixtures. Fixtures were used only in tests and are never application data. After the required network domains propagated, real stock quotes, index histories, crypto asset discovery, and reference FX rates returned successfully. Six provider-verified centralized exchanges returned in the tested directory page. A Bitcoin exchange-market request hit the provider rate limit, so that live listing path remains unverified; its filtering is covered by unit tests. A real one-hour index chart and viewport-filling chart expansion also passed browser checks. Provider rate limits and unsupported regional instruments still produce explicit unavailability states.

The complete pasted brief is retained in `docs/product-brief.md`; the uploaded text ends at the holding field “Wallet”. This implementation is a working foundation, not the full production platform. Still needed for the complete specification: licensed global exchange coverage and coverage audits, full country/exchange/sector/industry exploration, movers and volume screens, index constituents and sector distributions, a strictly CEX-only crypto universe and complete CEX coverage, provider failover, cloud accounts and storage, historical portfolio returns, dividends/corporate actions, volatility/drawdown/correlation/VaR analytics, operational monitoring, and deployment hardening.

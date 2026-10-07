# ShareBajar

**The world's markets. One portfolio.**

A responsive global market research and personal portfolio application. This first implementation provides a desktop workspace and mobile bottom navigation, global market catalog, universal asset search, provider-backed quotes and historical charts, watchlists, comparison, a dynamic crypto and CEX directory, and local portfolio tracking. It does not execute trades.

## Run

Android and iOS native projects are available in `android/` and `ios/`. See [mobile setup and build instructions](docs/mobile.md). Mobile builds require a deployed HTTPS backend URL.

The web app requires Python 3.12+ and Node 20+ for tests, with no frontend build needed. Native mobile builds also require the npm dependencies and platform tools described in the mobile guide.

```sh
cd /workspace/sharebajar
python server.py --host 0.0.0.0 --port 3000
```

The server automatically loads `.env` from the project root. Fill in its Google authentication settings (or copy `.env.example` for a new installation), then restart. Deployment environment variables override file values. For local Google sign-in, open `http://localhost:3000` and register `http://localhost:3000/api/auth/google/callback` in Google Cloud Console.

Default binding without `--host` is loopback. For local development, open port 3000 in your browser. No build or bundler is required. Do not expose this development server as a production deployment.

```sh
npm test
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS 'http://127.0.0.1:3000/api/quotes?symbols=AAPL'
```

The health route checks the application server; quote routes independently check provider access. A provider error is not a successful quote check.

## Data architecture

Asset details, exchange details, and recording a holding open as full-screen app views with a sticky Back button, mobile safe-area spacing, and their own scrolling. The chart's Focus chart action hides secondary details while keeping the full-screen view. Escape and Android Back close the current view and return to the workspace.

Overview now starts with portfolio valuations, daily change, unrealized gains, and the largest recorded holdings. A default country market, initially United States, is saved on the device and selects the index snapshot, news headlines, and initial Market Explorer filters. Dashboard totals explicitly exclude holdings with unavailable quotes or FX rates.

`news.py` fetches market-specific Google News RSS headlines for the past seven days and caches each market for five minutes. `/api/news?market=United%20States` returns publisher names, publication timestamps, feed article links, and the retrieval time. Headlines link through Google News to the original publication; no article bodies or generated news summaries are stored. The feed requires access to `news.google.com`. Missing feeds display an unavailable state independently of portfolio and quote data. Add the updated backend endpoint when deploying the mobile apps. `npm run test:ui` checks charts and dashboard behavior on desktop and mobile layouts.

The detail and comparison charts use locally bundled TradingView Lightweight Charts with price axes, quote markers, crosshair readouts, pan/zoom, and area/line views. Historical observations use UTC on the chart; quote timestamps use the device's local time. The feed supplies closing-price history, so these views do not fabricate candles or volume. The chart engine loads only when needed, and chart instances are disposed when their views close or change. Attribution and licenses are included in `static/vendor/`. Run `npm run charts:vendor` after upgrading the library and `npm run test:charts` for desktop/mobile browser checks (configured for installed Edge).

- `catalog.py`: discovery metadata, never market prices. The directory includes representative instruments across all requested regions. Universal search extends discovery to the security provider's supported universe.
- `providers.py`: replaceable Yahoo Finance research adapter and a `CryptoDataProvider` protocol implemented by CoinGecko. No generated prices, scraped pages, or sample-price fallbacks. Quotes retain provider source, timestamp, and available delay metadata. Crypto search and directory are dynamic, not a maintained list of thousands of symbols.
- `server.py`: JSON routes, static frontend, request validation, shared bounded quote worker pool, and short-lived provider cache.
- `static/finance.js`: testable multi-currency valuation with explicit handling of unavailable quotes and rates.
- `static/app.js`: navigation, search, filtering, chart inspection, watchlists, holdings, import/export, comparison, and allocation.

External destinations: `query1.finance.yahoo.com`, `api.coingecko.com`, and `api.frankfurter.dev`. Optional fonts use `fonts.googleapis.com` and `fonts.gstatic.com`. TLS verification stays enabled. Requests may fail because of rate limits, provider policy, regional coverage, or network restrictions. Failed quotes remain unavailable. Frankfurter rates are reference rates, not streaming FX rates, and do not cover every currency (including NPR in the current default feed).

Yahoo's public endpoints are a development/research adapter, not a licensed commercial data entitlement. Production deployment requires an appropriately licensed provider, configured credentials, coverage validation, and provider-specific exchange calendars. Catalog symbols are discovery candidates; their presence is not a coverage guarantee. NEPSE and other unserved regional markets explicitly require a licensed adapter.

CoinGecko's broad asset universe is shown for discovery. Individual asset exchange tables verify up to eight venues through provider exchange-detail responses; unclassified exchanges are omitted. The exchange directory verifies each page of ten entries through the same detail endpoint. Exchange details are cached for an hour to limit classification requests. This is not yet a complete, CEX-only asset universe. The exchange directory itself is paginated and filters to provider-confirmed centralized venues. It makes no safety or solvency claims.

## Portfolio behavior

Multiple named portfolios hold manually recorded positions, including cash. The holding form filters assets by category, searches the available catalog, and fetches the latest provider quote for the selected asset; quotes may be delayed and can be refreshed or copied into the purchase-price field. Purchase price/date remain the user's recorded cost basis, separate from current market value. Quantity, purchase price/date, currency, and an optional exchange/wallet are saved in browser localStorage. Export/import provides JSON backups. Membership accounts use server-side SQLite and revocable sign-in sessions. Google OAuth, expiring one-time password reset links, and a role-protected user administration panel are available when configured. See [account setup and administrator guide](docs/authentication.md). Holdings remain local: there is no server-side holding storage or synchronization between devices.

Valuations convert quote and cost-basis currencies into the chosen base currency using current reference FX rates. Holdings with missing prices or FX rates are excluded from subtotals and explicitly counted. Daily change uses price movement at current FX; it excludes the effect of daily FX changes. Missing daily movements produce an unavailable total, rather than zero. Unrealized returns compare present values with recorded cost basis converted at current FX; they are not tax or time-weighted returns. Allocation reports instrument domicile and quote currency, not underlying business revenue exposure.

## Validation and remaining scope

`npm test` runs valuation and provider normalization tests. Browser checks during implementation exercised real unavailable-feed behavior, watchlist persistence, cash recording, reload persistence, allocation, regional coverage messages, responsive layout, and interactive charts/comparison with isolated provider fixtures. Fixtures were used only in tests and are never application data. After the required network domains propagated, real stock quotes, index histories, crypto asset discovery, and reference FX rates returned successfully. Six provider-verified centralized exchanges returned in the tested directory page. A Bitcoin exchange-market request hit the provider rate limit, so that live listing path remains unverified; its filtering is covered by unit tests. A real one-hour index chart and viewport-filling chart expansion also passed browser checks. Provider rate limits and unsupported regional instruments still produce explicit unavailability states.

The complete pasted brief is retained in `docs/product-brief.md`; the uploaded text ends at the holding field “Wallet”. This implementation is a working foundation, not the full production platform. Still needed for the complete specification: licensed global exchange coverage and coverage audits, full country/exchange/sector/industry exploration, movers and volume screens, index constituents and sector distributions, a strictly CEX-only crypto universe and complete CEX coverage, provider failover, cloud accounts and storage, historical portfolio returns, dividends/corporate actions, volatility/drawdown/correlation/VaR analytics, operational monitoring, and deployment hardening.


### AI memberships

Plus unlocks portfolio and recorded investment-habit summaries. Pro includes Plus and adds cited AI research reports on all asset detail pages. Reports use server-fetched prices, sourced news headlines, and optional US-stock fundamentals; unavailable evidence is disclosed. Memberships are enforced on the server. See [AI setup and membership provisioning](docs/ai-analysis.md) for environment variables, activation, quotas, and current billing limitations.

Analysis combines an account-synced Pro asset research chat, provider-sourced daily candlesticks, selectable SMA/EMA/Bollinger/RSI/MACD indicators, and transparent historical scenario ranges with the existing comparison and portfolio Research Studio. The chat explains server-calculated indicators; its projections are historical statistical scenarios, never AI-invented price targets. Public visitors can inspect candles but cannot retrieve gated signals. See [Analysis methodology and access](docs/ai-analysis.md#analysis-workspace) and [research history and scenario methodology](docs/ai-analysis.md#pro-asset-chat-and-scenarios).

## Landing page

The signed-out root route opens the Sharebajar terminal dashboard (`/#home`): 22 financial news categories, regional Google News RSS feeds for the last 24 hours, a provider-backed market monitor and ticker, asset search, and an interactive price chart. News and quotes refresh every 60 seconds while the screen is visible; provider timestamps and unavailable-data states remain explicit. Mobile uses horizontally scrollable categories and stacked panels. Account and research actions use the existing membership flows; the expanded AI workspace is available at `/#charts`.


## Financial growth platform

Public valuation rankings, structured financial research pages, account portfolios/reports and Expo mobile screens are now available. See [financial platform architecture](docs/financial-platform.md) and [Expo mobile setup](mobile-app/README.md).

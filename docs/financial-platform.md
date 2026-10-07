# Sharebajar financial platform

Sharebajar is a financial research and portfolio analysis product. Public financial pages and mobile layouts consume the same structured research contract. Generated pages focus on market valuation, investment themes, asset discovery, and investor education.

## Run and explore

Run `python server.py --port 3000` (or `npm start`) from the application directory. The Python mock backend uses the standard library.

- /: global discovery, free AI asset bar, valuation ideas, charts/news links
- /markets, /markets/nepal/stocks, /markets/us/valuation?valuation=undervalued: public country rankings and relative valuation screens
- /asset/us/AAPL, /asset/nepal/NABIL: asset research, illustrative chart and mock fundamental valuation
- /research, /trends, /compare, /learn, /campaigns: crawlable curated financial experiences
- /pricing, /about, /app: product, subscription and 15 interactive mobile screen previews
- /workspace: sign-in gate for shared account watchlists, portfolio imports, research, reports, scenarios, alerts and preferences
- /internal/page-generator: administrator-only draft generation and explicit publish action

The existing interactive dashboard remains at /#overview, /#charts, /#news, /#research and /#search.

Set SHAREBAJAR_PUBLIC_URL to the deployed HTTPS origin for canonical URLs, schema and sitemap. Locale/timezone suggests a market without redirecting; manual choices persist in localStorage and a SameSite cookie. The homepage reads the cookie to render a matching market lens. Any market remains accessible.

## Financial generation engine

financial_engine.py supplies 12 templates: ranking, asset, sector, trend, comparison, portfolio risk, education, landing, campaign, mobile screen, investor dashboard and newsletter. Each produces:

- Title, description, canonical, breadcrumbs/WebPage/ItemList JSON-LD
- Hero, market metrics, ranking rows, asset cards and research summary
- Evidence, assumptions, limitations, internal links and plan CTA
- Shared design system ID, responsive layout order, iOS/Android screen specification

The implementation is deterministic structured generation using mock data. It is not a live LLM or a trend-monitoring service. Supplied search volume, social discussion, catalysts, country interest, sector momentum, crypto narratives, ETF flows and watchlist activity are labelled unverified. Existing live OpenAI asset/portfolio reports remain available when provider credentials and account access are configured.

Administrators generate an account-owned draft via POST /api/financial/generate. They review it before POST /api/financial/publish. Published pages receive a unique /research/generated/[slug] route and enter the sitemap. Portfolio and personalized dashboard templates remain private and cannot be published. Drafts and private APIs reject unauthorized requests. Use existing manage_users.py administration to assign a trusted administrator; no public request can grant itself a role or plan.

## Valuation methodology

Mock stocks, ETFs and indexes receive deterministic P/E, P/B, yield and growth values against assumed sector benchmarks. ETF/index values represent illustrative aggregate exposures, not issuer earnings. The relative score combines lower peer multiples with a small growth adjustment. Categories are research screens, not intrinsic values, verified recommendations or price targets. Country market scores and medians use **stocks only**. Crypto has no P/E, P/B or equity valuation score; liquidity, volume and momentum provide its discovery context.

Portfolio values, gains, risk concentration and scenarios stay grouped by native currency. No unconverted USD/NPR/etc. amounts are added. Bear −20%, Base +5% and Bull +20% are explicit constant-change assumptions without probabilities, dividends, taxes or FX forecasts.

## APIs shared with mobile

static/shared/financial-api.js is a dependency-free fetch client consumed by web modules and Expo. Authentication uses the existing opaque bearer session. Native tokens use Expo SecureStore; browser tokens use sessionStorage.

| Endpoint | Access | Purpose |
| --- | --- | --- |
| GET /api/markets/config | Public | 18 markets, exchanges, currencies, locales |
| GET /api/financial/templates | Public | Template catalog and subscription definitions |
| GET /api/financial/valuation?market=us | Public | Enriched mock assets, market lens and filters |
| GET /api/financial/page?path=/compare/us/aapl-vs-msft | Public | Curated public page contract |
| GET /api/financial/screens?market=nepal | Public | Screen layout specifications; no personal data |
| GET /api/financial/drafts | Admin | Own drafts |
| POST /api/financial/generate | Admin | Validated structured draft |
| POST /api/financial/publish | Admin | Explicit publish of own public draft |
| GET /api/growth/state | Account | Own workspace state |
| POST /api/growth/action | Account/plan | Watchlist, portfolio, reports, alerts, preferences |
| GET /api/growth/export?id=... | Pro | Own Markdown research export |

Free includes public markets/basic assets and 25 account watchlist items. Plus ($19/month) adds portfolio analysis, AI asset/portfolio research, saved reports and advanced rankings. Pro ($99/month) adds scenario forecasts, advanced templates, multiple portfolios and exports. Checkout URLs and priority live-data refresh require production integration. CSV/manual import and demo sync do not connect a broker. Alerts evaluate mock snapshots in-app, without external delivery.

## Replaceable services and deployment direction

The current repository uses a Python HTTP API and SQLite. It is retained so existing chart, membership, research and public AI functionality continues working. Public pages are server-rendered for SEO. A Next.js App Router frontend can consume the structured contracts without duplicating financial logic; this change does not migrate the running app to Next.js.

Replace market_catalog.assets_for with licensed market adapters while preserving the shared fields and source timestamps. Extend enrich_asset to accept provider fundamentals rather than deterministic assumptions. Replace trend inputs with a sourced collector; replace the structured summary engine with a validated model adapter. Keep provenance, stale-data status, entitlement checks and private-page visibility at API boundaries.

For production scale, implement repository adapters for PostgreSQL accounts/portfolios/content, Redis cache/quota windows, and Meilisearch or Typesense asset search. These are integration boundaries, not connected services in this mock implementation. Real broker sync, forecasting models, push delivery, payments and provider ingestion remain explicit production integrations.

## Verification

Run `python -m unittest discover -s tests -p "test_*.py"` for route, metadata, valuation, quota, account ownership, CSV validation, publishing and plan checks. Existing Node calculation tests run with npm test. Browser smoke checks cover public AI mounting, valuation filters, authenticated generator review/publish, portfolio import/risk, saved reports, Pro scenarios and mobile overflow.

# AI analysis and memberships

Plus includes portfolio and recorded investment-habit summaries; Pro includes those features and asset research on every asset detail page. Reports are generated on demand, cite supplied evidence, show data limitations and research questions, and can be downloaded as JSON on web or shared on Android/iOS.

## Backend configuration

Set `OPENAI_API_KEY` in the backend's private process environment or hosting secret manager, then restart `server.py`. Never put this key in mobile/web builds or chat. `.env.example` documents the settings; the server automatically loads the repository-root `.env` at startup, preserving any settings already present in the process environment. `OPENAI_MODEL` defaults to `gpt-4.1-mini` and can be overridden with a Responses-compatible model supporting structured outputs.

Optionally set `ALPHAVANTAGE_API_KEY` for company OVERVIEW fundamentals. Current fundamentals support US stocks on NASDAQ, NYSE and NYSE American. Other assets still get price/news research with explicit gaps. Verify your provider plan and data coverage before launch. Yahoo and CoinGecko supply price snapshots; Google News RSS supplies publisher-attributed headlines, not article bodies.

The API uses [OpenAI Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and validates citations against server-supplied evidence. It sets `store:false`; this is not a promise of zero retention. Review [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) for your deployment. Portfolio requests disclose that holdings, quantities, purchase costs and dates are sent to OpenAI. Wallet labels, portfolio names and account email are omitted from model inputs. Account authentication is separate from local portfolio backups.

## Membership activation

Create an account using Membership in the app. New accounts always start on Free; client-supplied plan flags cannot grant access. On the trusted backend, provision a time-limited membership:

```powershell
python scripts/set_membership.py --email member@example.com --plan plus --days 30
python scripts/set_membership.py --email member@example.com --plan pro --days 30
```

Set `SHAREBAJAR_ACCOUNT_DB` to a persistent SQLite file location, or use `.data/accounts.sqlite` (git-ignored). Passwords use salted PBKDF2 hashes; bearer sessions expire after 24 hours and are revoked on sign-out. The frontend keeps the session in sessionStorage. Expired memberships become Free.

Plus allows 10 report attempts per UTC day; Pro allows 40 total attempts. Failed provider/model calls also consume an attempt. Server concurrency is limited to 3 reports. Authentication is limited to 30 requests per client IP per hour.

Optional `SHAREBAJAR_PLUS_CHECKOUT_URL` and `SHAREBAJAR_PRO_CHECKOUT_URL` provide HTTPS upgrade links. No billing provider or verified payment webhook is integrated yet. Checkout links alone do not activate memberships. Connect verified billing fulfillment to server-owned membership provisioning before offering automated paid activation. Mobile store billing still needs its own integration.

## Deployment and limits

Serve the backend over HTTPS. Native Capacitor origins are allowed for API preflight; additional exact web origins may be specified as a comma-separated `SHAREBAJAR_ALLOWED_ORIGINS`. Set `SHAREBAJAR_API_URL` to the real HTTPS backend before `npm run mobile:sync`; placeholder origins are build verification only.

Password recovery is implemented when SMTP is configured; email verification is not implemented. Persist and protect the membership database, and complete production deployment hardening before launch. Holdings still live on each device; sign-in does not synchronize them. Investment habits describe current recorded purchases only, not complete transaction history or lifetime performance. Missing prices/FX are excluded explicitly. News and current fundamentals cannot support historical tax or dividend accounting.

## Verification

`npm test` checks server membership enforcement, session expiry/revocation, throttling, input validation, and mocked Responses contracts. `npm run test:ui` verifies desktop/mobile upgrade screens, report generation, escaping/citations, downloads, charts and portfolio overview. Live OpenAI generation requires a configured server key and has not been verified in this workspace.

## Analysis workspace

Analysis is now the main research workspace. Compare was removed from navigation; old `#compare` links redirect to `#analysis`. The default AI Chat tab searches provider-supported assets and displays daily OHLC candlesticks. The Research Studio tab retains featured comparisons, completed-day timeframes, indicators, optional benchmarks, swipeable templates, portfolio research, and expandable cited results. Plus users can edit questions and ask follow-ups; each result retains its own assets, resolved timeframe, benchmark, selected portfolio snapshot and bounded conversation context even after the controls change.

`POST /api/research` enforces access independently of the frontend. Free users can run predefined comparison and price snapshot templates over the last completed calendar quarter, limited to three attempts per UTC day (signed-in account or client IP). Advanced templates, other timeframes, edited prompts and conversational follow-ups require Plus or Pro. Paid requests share the existing 10/40 daily AI attempt quota. Free predefined reports use server calculations and do not require an OpenAI key; Plus interpretations use the server Responses integration. The Pro gate on asset-detail AI reports remains in place.

The quarter is a calendar quarter, not a rolling three-month range. Exact historical requests include a preceding observation for the return baseline; every result shows requested dates and actual sample dates. Insufficient or stale endpoint coverage yields unavailable returns. Price returns use observed closes / UTC samples, exclude dividends and FX, and are separated from latest reported quarterly year-over-year revenue and earnings growth. Company overview valuations and dividend yields are current provider snapshots and are not historical quarter-end figures. Fundamentals require the optional configured provider and supported stock exchange. Non-company asset indicators are marked inapplicable; ETF fund fundamentals/distribution yield are unavailable without a fund-specific feed.

Volatility uses sample standard deviation of daily log returns, annualized with 252 market sessions or 365 crypto days, requiring at least 20 returns and no excessive sample gaps. Volume is average reported per-session shares/contracts for securities/futures or average rolling 24-hour USD volume for crypto; these units are labeled and cannot be treated as identical liquidity measures. Index/FX placeholder volume is not displayed as trading activity. Benchmark excess requires matching endpoint dates and quote currency. Auto references use supported country equity indexes or Bitcoin for crypto; other asset types need an explicit appropriate reference.

Portfolio results provide current allocation and largest aggregated asset weight. Historical benchmark comparison is an explicitly hypothetical fixed basket of current quantities, not actual account returns. It is calculated only with complete matching histories and base-currency assets, excludes historical cash flows, rebalancing, sold positions and dividends, and plots common observed dates. Foreign currency baskets remain unavailable because historical FX accounting is absent. Up to 12 distinct non-cash portfolio assets are supported by this historical research workflow; current portfolio reports retain the 50-holding limit.

Tables scroll inside the result on small screens, with sticky indicator labels; normalized performance charts support touch pan, pinch zoom and accessible zoom/reset buttons. Results are expandable and exportable as JSON. Facts/calculations, AI interpretations, risks and timestamped sources have separate display areas. Loading, empty portfolios, missing coverage and retryable errors are explicit. Research Studio results remain in workspace memory; the separate Pro asset-chat history is saved to the account database. No OpenAI persistent conversation object is created. Follow-up AI requests receive bounded previous questions/takeaways as untrusted context, with refreshed provider evidence for each response.

### Pro asset chat and scenarios

Pro users can ask follow-up questions about a selected asset. Conversation titles, user messages, assistant summaries, and the research payload are stored in the same SQLite account database as memberships. Each list/get/delete operation is scoped to the authenticated account on the server; conversation identifiers are not authorization. Storage is bounded to 100 conversations per account and 100 messages per conversation. Users can delete saved chats in the workspace. Back up and protect the account database; this single-server SQLite design is not intended for multi-host deployment.

`GET /api/candles` returns historical OHLC candles without technical indicators and is available for public chart browsing. `GET /api/research/technicals` requires an active Pro membership and returns calculations; `POST /api/research/chat` also requires Pro and saves each completed prompt/response. Google/Alpha Vantage/market provider coverage does not imply complete asset coverage. Daily candle and technical data use Yahoo Finance or CoinGecko; licensed feeds are required for production commercial use.

The app calculates SMA(20/50/200), EMA(20), Bollinger bands (20-period, two population standard deviations), Wilder RSI(14), and MACD(12/26/9) from provider closes. The selectable 1-week, 1-month, and 3-month scenario is deterministic: it uses up to 90 recent log returns, historical mean drift and sample volatility, and an illustrative 95% normal range in log-price space. Equity horizons use 5/21/63 trading sessions; crypto horizons use 7/30/90 daily observations. At least 20 returns are required. This is a simplified historical scenario—not a calibrated forecast, target, guarantee, or investment recommendation. Data gaps, corporate actions, fees, and regime shifts may make it unsuitable. The AI receives only a compact server-calculated indicator/projection summary and provider source, alongside the existing dated asset evidence; it does not supply numerical indicator or projection values.

For each chat request, the selected asset, user question, and up to eight prior question/summary pairs are sent to the configured OpenAI Responses API. The page discloses this before use; users should not include sensitive personal information. `store:false` is set on the model request, but this is not a promise of zero retention. See OpenAI's data controls above. Conversation history is account-synchronized on this server and is separate from local portfolio backups. Authentication, Pro entitlement and ownership are checked server-side; hiding the indicators in the browser is not the security boundary.

## Portfolio planning assistant

Explore includes a Plus planning assistant. Add holdings using the existing signed-in holding form, then enter a goal, time horizon, monthly contribution in your base currency, stated risk preference, and liquidity needs. `/api/ai/plan` enforces Plus access and validates preferences before fetching portfolio evidence. Reports review allocation, concentration, currency exposure, goal alignment and a planning checklist. They do not execute trades or constitute a suitability assessment. Holdings and goals are sent to OpenAI only when generating; wallet labels and portfolio names are omitted. Reports can be downloaded. The report is kept in the current screen only; holdings remain stored locally.

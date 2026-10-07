# Public market rankings

All routes are server-rendered and require no account:
- /markets
- /markets/{marketCode}
- /markets/{marketCode}/{stocks|crypto|etfs|indexes|gainers|losers|trending|most-watched}
- /markets/{marketCode}/sectors/{sector}
- /asset/{marketCode}/{symbol}

market-config.json defines 18 market configurations. market_catalog.py provides explicitly labeled mock quotes, change periods, trending scores, watch counts, fund examples and index samples. These values do not imply current prices, verified listing availability, or investor activity. Replace assets_for() with provider adapters when integrating licensed real feeds; keep asset records and ranking API contracts stable.

GET /api/markets/config returns market definitions.
GET /api/markets/rankings accepts market, view, type, sector and range (1d, 7d, 1mo, 1y). All responses identify their source as mock.

The market selector suggests a country from navigator.languages region tags, falling back to the browser time zone. It does not query an IP service or precise browser geolocation. Suggestions need explicit acceptance. Manual selections persist in localStorage under sharebajar-market and sharebajar-market-country. Any supported market remains accessible.

Set SHAREBAJAR_PUBLIC_URL to the production HTTPS origin for canonical URLs, breadcrumb JSON-LD, robots.txt and sitemap.xml. The local fallback is http://localhost:3000. Sitemap URLs are generated from supported market routes, sectors and mock assets. Filter query parameters canonicalize to their base ranking route.

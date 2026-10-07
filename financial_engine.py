"""Structured financial research experiences from replaceable mock market data.

This is a deterministic template engine, not a live LLM, market feed, or an
investment recommendation system. Renderers consume this JSON contract on web,
iOS, and Android; provider adapters can later replace the mock catalog.
"""
from copy import deepcopy
from hashlib import sha256
import math
import re
from statistics import median
from urllib.parse import quote, urlsplit

from market_catalog import BY_CODE, MARKETS, SECTORS, assets_for, ranked_assets

SCHEMA_VERSION = "1.0"
DESIGN_SYSTEM = "sharebajar-v1"
DATA_SOURCE = "Illustrative mock catalog and deterministic template analysis"
PERIODS = ("1d", "7d", "1mo", "1y")
VALUATIONS = ("all", "undervalued", "fair", "overvalued", "dividend", "growth")
PRICING = [
    {"id": "free", "name": "Free", "monthlyPrice": 0, "currency": "USD", "features": ["Public rankings", "Basic asset research", "Basic watchlist"]},
    {"id": "plus", "name": "Plus", "monthlyPrice": 19, "currency": "USD", "features": ["AI research", "Portfolio analysis", "Saved reports", "Advanced rankings"]},
    {"id": "pro", "name": "Pro", "monthlyPrice": 99, "currency": "USD", "features": ["Forecast scenarios", "Advanced prompt templates", "Multiple portfolios", "Research exports", "Priority data refresh"]},
]
PAGE_TEMPLATES = [
    {"id": "market-ranking", "name": "Market ranking", "visibility": "public", "description": "Rank assets by market, valuation, momentum, volume, and dividends."},
    {"id": "asset-detail", "name": "Asset research", "visibility": "public", "description": "Combine asset fundamentals, valuation, trends, and market context."},
    {"id": "sector", "name": "Sector research", "visibility": "public", "description": "Screen financial, technology, energy, consumer, and healthcare assets."},
    {"id": "trend", "name": "Trend research", "visibility": "public", "description": "Connect supplied catalysts and interest signals with assets."},
    {"id": "comparison", "name": "Asset comparison", "visibility": "public", "description": "Compare asset valuation, growth, yield, and momentum."},
    {"id": "portfolio-research", "name": "Portfolio risk report", "visibility": "private", "description": "Review position weights, sector concentration, and mock scenario exposure."},
    {"id": "education", "name": "Investor education", "visibility": "public", "description": "Create market-specific guides grounded in financial concepts."},
    {"id": "landing", "name": "Research landing", "visibility": "public", "description": "Explain a focused financial research workflow and its benefits."},
    {"id": "campaign", "name": "Financial research campaign", "visibility": "public", "description": "Present an investment research theme and relevant asset screen."},
    {"id": "app-screen", "name": "Mobile app screen", "visibility": "public", "description": "Produce shared iOS and Android financial screen specifications."},
    {"id": "investor-dashboard", "name": "Investor dashboard", "visibility": "private", "description": "Organize market, portfolio, watchlist, and report widgets."},
    {"id": "newsletter", "name": "Market newsletter", "visibility": "public", "description": "Build an evidence-led market brief with internal research links."},
]
_TEMPLATE_BY_ID = {item["id"]: item for item in PAGE_TEMPLATES}
_ALIASES = {"market": "market-ranking", "ranking": "market-ranking", "asset": "asset-detail", "compare": "comparison", "portfolio": "portfolio-research", "learn": "education", "app": "app-screen", "dashboard": "investor-dashboard", "seo-market": "market-ranking"}
MOBILE_SCREENS = [
    {"id": "onboarding", "name": "Welcome to Sharebajar", "visibility": "public"},
    {"id": "choose-market", "name": "Choose your market", "visibility": "public"},
    {"id": "home", "name": "Market dashboard", "visibility": "public"},
    {"id": "search", "name": "Search assets", "visibility": "public"},
    {"id": "rankings", "name": "Market rankings", "visibility": "public"},
    {"id": "asset-detail", "name": "Asset research", "visibility": "public"},
    {"id": "watchlist", "name": "Watchlist", "visibility": "private"},
    {"id": "portfolio-import", "name": "Import portfolio", "visibility": "private"},
    {"id": "portfolio", "name": "Portfolio overview", "visibility": "private"},
    {"id": "ai-chat", "name": "AI research assistant", "visibility": "private"},
    {"id": "forecast", "name": "Forecast scenarios", "visibility": "private"},
    {"id": "alerts", "name": "Alerts", "visibility": "private"},
    {"id": "saved-reports", "name": "Saved reports", "visibility": "private"},
    {"id": "pricing", "name": "Choose a research plan", "visibility": "public"},
    {"id": "profile", "name": "Profile and settings", "visibility": "private"},
]
_SCREEN_BY_ID = {item["id"]: item for item in MOBILE_SCREENS}
_BENCHMARKS = {"technology": (26.0, 5.0), "financials": (12.0, 1.8), "energy": (16.0, 2.3), "consumer": (22.0, 3.2), "healthcare": (24.0, 3.8), "diversified": (21.0, 3.0)}
_LIMITATIONS = [
    "All prices, valuation metrics, trend signals, and scenarios are illustrative mock data, not current market observations.",
    "Valuation categories are relative research screens against assumed sector multiples; they are not verified intrinsic values or price targets.",
    "Trend activity and scenarios do not establish causation or predict returns. Verify filings, liquidity, fees, currency exposure, and current sources before decisions.",
]


def list_templates():
    return deepcopy(PAGE_TEMPLATES)


def _seed(value):
    return int(sha256(value.encode("utf-8")).hexdigest()[:8], 16)


def _text(value, field, maximum=160, default=""):
    if value is None:
        return default
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError(field + " must be text of at most " + str(maximum) + " characters")
    return value.strip()


def _slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:100] or "research"


def _asset_url(asset):
    return "/asset/" + asset["marketCode"] + "/" + quote(asset["symbol"], safe="")


def enrich_asset(asset):
    """Return a copy with mock fundamentals and a transparent relative screen."""
    result = deepcopy(asset)
    seed = _seed(asset["marketCode"] + ":" + asset["symbol"])
    stocklike = asset["assetType"] in ("stocks", "etfs", "indexes")
    peer_pe, peer_pb = _BENCHMARKS.get(asset["sector"], (21.0, 3.0))
    if stocklike:
        # Three buckets create useful mock screens without inventing live facts.
        bucket = seed % 3
        multiple_ratio = (0.60, 1.00, 1.50)[bucket] + ((seed >> 5) % 9 - 4) / 100
        pe = round(peer_pe * multiple_ratio, 2)
        pb = round(peer_pb * (0.70, 1.00, 1.45)[bucket], 2)
        earnings_growth = round(4 + (seed % 220) / 10, 1)
        dividend_yield = round((seed >> 3) % 65 / 10, 1)
        score = max(0, min(100, round(50 + (1 - pe / peer_pe) * 65 + (1 - pb / peer_pb) * 20 + (earnings_growth - 10) * 0.35)))
        category = "undervalued" if score >= 65 else "overvalued" if score < 40 else "fair"
        label = {"undervalued": "Below assumed peer multiples", "fair": "Near assumed peer multiples", "overvalued": "Above assumed peer multiples"}[category]
        rationale = str(pe) + "x mock P/E versus a " + str(peer_pe) + "x assumed sector benchmark; " + str(pb) + "x P/B with " + str(earnings_growth) + "% illustrative earnings growth."
        if asset['assetType'] in ('etfs','indexes'):
            rationale += ' Fund/index multiples and growth describe illustrative aggregate holdings exposure, not issuer earnings.'
        method = "Relative sector P/E and P/B screen, with a small earnings-growth adjustment. Higher scores indicate lower assumed multiples."
    else:
        pe = pb = earnings_growth = dividend_yield = score = None
        category, label = "not-rated", "Fundamental multiples not applicable"
        rationale = "Crypto assets are screened by liquidity, volume, price momentum, and narrative interest; P/E and P/B are not assigned."
        method = "Crypto liquidity and momentum context; no equity-style fair-value score."
    result.update(pe=pe, pb=pb, dividendYield=dividend_yield, earningsGrowth=earnings_growth,
                  valuationScore=score, valuationCategory=category, valuationLabel=label,
                  valuationRationale=rationale, valuationMethodology=method, peerPe=peer_pe if stocklike else None,
                  peerPb=peer_pb if stocklike else None, volatility=round(18 + seed % 290 / 10, 1),
                  liquidityScore=min(100, 45 + seed % 55), assetUrl=_asset_url(asset),
                  isMock=True, dataSource=DATA_SOURCE)
    return result


def valuation_assets(code=None, view="", sector="", asset_type="", period="1d", valuation="all", sort="valuation"):
    if code is not None and code not in BY_CODE:
        raise ValueError("Unsupported marketCode")
    if period not in PERIODS:
        raise ValueError("Unsupported time range")
    if valuation not in VALUATIONS:
        raise ValueError("Unsupported valuation filter")
    if view and view not in ("stocks", "crypto", "etfs", "indexes", "gainers", "losers", "trending", "most-watched", "valuation"):
        raise ValueError("Unsupported ranking view")
    if asset_type and asset_type not in ("stocks", "crypto", "etfs", "indexes"):
        raise ValueError("Unsupported assetType")
    if sector and sector not in SECTORS + ["digital-assets", "diversified"]:
        raise ValueError("Unsupported sector")
    rows = [enrich_asset(a) for a in ranked_assets(code, "" if view == "valuation" else view, sector, asset_type, period)]
    if valuation in ("undervalued", "fair", "overvalued"):
        rows = [a for a in rows if a["valuationCategory"] == valuation]
    elif valuation == "dividend":
        rows = [a for a in rows if a["dividendYield"] is not None and a["dividendYield"] >= 3]
    elif valuation == "growth":
        rows = [a for a in rows if a["earningsGrowth"] is not None and a["earningsGrowth"] >= 15]
    if valuation == "dividend":
        rows.sort(key=lambda a: a["dividendYield"], reverse=True)
    elif valuation == "growth":
        rows.sort(key=lambda a: a["earningsGrowth"], reverse=True)
    elif sort == "volume":
        rows.sort(key=lambda a: a["volume"], reverse=True)
    elif sort == "market-cap":
        rows.sort(key=lambda a: a["marketCap"], reverse=True)
    elif sort == "valuation" and view not in ("gainers", "losers", "trending", "most-watched"):
        rows.sort(key=lambda a: (a["valuationScore"] is not None, a["valuationScore"] or 0, a["marketCap"]), reverse=True)
    elif sort not in ("valuation", "volume", "market-cap", "default"):
        raise ValueError("Unsupported sort")
    return rows


def market_valuation(code):
    rows = valuation_assets(code)
    equities = [a for a in rows if a["assetType"] == "stocks"]
    score = round(sum(a["valuationScore"] * a["marketCap"] for a in equities) / sum(a["marketCap"] for a in equities)) if equities else None
    category = "undervalued" if score is not None and score >= 65 else "overvalued" if score is not None and score < 40 else "fair" if score is not None else "not-rated"
    counts = {v: sum(a["valuationCategory"] == v for a in equities) for v in ("undervalued", "fair", "overvalued")}
    country = BY_CODE[code]["countryName"]
    return {"marketCode": code, "countryName": country, "valuationScore": score, "valuationCategory": category,
            "medianPe": round(median(a["pe"] for a in equities), 2) if equities else None,
            "medianPb": round(median(a["pb"] for a in equities), 2) if equities else None,
            "dividendYield": round(median(a["dividendYield"] for a in equities), 2) if equities else None,
            "counts": counts, "assetCount": len(rows), "stockCount": len(equities),
            "headline": country + (" relative valuation screen" if equities else " liquidity and momentum screen"),
            "summary": (str(counts["undervalued"]) + " of " + str(len(equities)) + " mock stocks screen below assumed peer multiples. Compare growth, yield, and concentration alongside valuation." if equities else "Equity P/E and P/B do not apply to crypto. Compare mock trading volume, liquidity, and narrative interest."),
            "methodology": "Market score is market-cap weighted across mock stocks only. Sector benchmark multiples are assumptions, not live estimates.",
            "featuredPages": [{"label": "Valuation research", "url": "/markets/" + code + "/valuation"}, {"label": "Trend research", "url": "/trends/" + code + "/trending-assets-this-week"}],
            "isMock": True, "dataSource": DATA_SOURCE, "limitations": deepcopy(_LIMITATIONS)}


def _trend_inputs(value):
    if value is None:
        return {}
    if not isinstance(value, dict) or len(value) > 15:
        raise ValueError("trendInputs must be a bounded object")
    allowed = {"trendingAssets", "searchVolume", "socialDiscussion", "catalysts", "earningsCatalysts", "newsCatalysts", "countryInterest", "gainersLosers", "investorInterest", "sectorMomentum", "cryptoNarratives", "etfFlows", "watchlistActivity"}
    result = {}
    for key, signal in value.items():
        if key not in allowed:
            raise ValueError("Unsupported trend input: " + str(key))
        if isinstance(signal, bool) or not isinstance(signal, (str, int, float, list, dict)):
            raise ValueError("Invalid trend signal: " + key)
        if isinstance(signal, (int, float)):
            if not math.isfinite(signal):
                raise ValueError("Trend signals must be finite")
        elif isinstance(signal, str):
            signal = _text(signal, key, 500)
        elif isinstance(signal, list):
            if len(signal) > 30:
                raise ValueError("Too many trend signals")
            signal = [_text(item, key, 250) for item in signal]
        else:
            if len(signal) > 30 or any(not isinstance(k, str) or len(k) > 80 or isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for k, v in signal.items()):
                raise ValueError("Signal maps need bounded names and finite numeric values")
        result[key] = signal
    return result


def _portfolio(holdings, code):
    if holdings is None:
        holdings = [{"symbol": a["symbol"], "quantity": 10 + i * 5} for i, a in enumerate(assets_for(code)[:3])]
    if not isinstance(holdings, list) or not holdings or len(holdings) > 100:
        raise ValueError("holdings must contain 1 to 100 positions")
    lookup = {a["symbol"].upper(): enrich_asset(a) for a in assets_for(code)}
    positions = []
    for holding in holdings:
        if not isinstance(holding, dict):
            raise ValueError("Each holding must be an object")
        symbol = _text(holding.get("symbol"), "symbol", 30).upper()
        quantity = holding.get("quantity")
        if symbol not in lookup or isinstance(quantity, bool) or not isinstance(quantity, (int, float)) or not math.isfinite(quantity) or quantity <= 0 or quantity > 1e12:
            raise ValueError("Holdings require supported symbols and positive finite quantities")
        asset = deepcopy(lookup[symbol]); asset.update(quantity=quantity, positionValue=round(quantity * asset["price"], 2))
        positions.append(asset)
    total = sum(a["positionValue"] for a in positions)
    sectors = {}
    for asset in positions:
        asset["weight"] = round(asset["positionValue"] / total * 100, 2)
        sectors[asset["sector"]] = sectors.get(asset["sector"], 0) + asset["weight"]
    largest = max(a["weight"] for a in positions)
    return {"currency": BY_CODE[code]["currency"], "totalValue": round(total, 2), "positions": positions,
            "largestPositionPercent": largest, "sectorWeights": {k: round(v, 2) for k, v in sectors.items()},
            "riskLevel": "High concentration" if largest > 50 or max(sectors.values()) > 70 else "Moderate concentration",
            "scenarios": [{"label": "Downside stress", "changePercent": -15, "value": round(total * .85, 2)}, {"label": "Flat market", "changePercent": 0, "value": round(total, 2)}, {"label": "Upside scenario", "changePercent": 10, "value": round(total * 1.10, 2)}],
            "scenarioMethodology": "Uniform illustrative portfolio shocks; these are stress scenarios, not probabilistic forecasts.", "isMock": True}


def _default_title(template, country, rows, sector, valuation, topic, screen):
    if template == "asset-detail":
        return rows[0]["name"] + " (" + rows[0]["symbol"] + ") Research"
    if template == "comparison":
        return rows[0]["name"] + " vs " + rows[1]["name"] + " Stock Comparison"
    if template == "app-screen":
        return _SCREEN_BY_ID[screen]["name"]
    if template == "portfolio-research":
        return "Portfolio Risk Report"
    if template == "investor-dashboard":
        return "Your Investor Dashboard"
    if template == "education":
        return topic or "Beginner Guide to " + ("NEPSE" if country == "Nepal" else country + " Investing")
    if template == "newsletter":
        return country + " Weekly Market Brief"
    if topic:
        return topic
    if template == "trend":
        return "Trending Assets This Week in " + country
    if template == "sector":
        return ("Undervalued " if valuation == "undervalued" else "") + sector.replace("-", " ").title() + " Stocks in " + country
    if template in ("landing", "campaign"):
        return "Build Your Financial Research Edge in " + country
    noun = "Crypto Assets Globally" if country == "Global Crypto Market" else "Stocks in " + country
    return ("High Dividend " if valuation == "dividend" else "Undervalued " if valuation == "undervalued" else "Top ") + noun


def generate_page(payload, base_url="https://sharebajar.com"):
    """Return one complete, JSON-serializable page/screen contract.

    Access control belongs at API/render boundaries. Callers MUST enforce
    visibility/private membership before returning or persisting private pages.
    """
    if not isinstance(payload, dict):
        raise ValueError("Page generation input must be an object")
    template = _text(payload.get("template", payload.get("pageType", "market-ranking")), "template", 40)
    template = _ALIASES.get(template, template)
    if template not in _TEMPLATE_BY_ID:
        raise ValueError("Unsupported financial page template")
    code = _text(payload.get("marketCode", payload.get("market", "us")), "marketCode", 30).lower()
    if code not in BY_CODE:
        raise ValueError("Unsupported marketCode")
    market = deepcopy(BY_CODE[code]); country = market["countryName"]
    sector = _text(payload.get("sector"), "sector", 40)
    asset_type = _text(payload.get("assetType"), "assetType", 20)
    valuation = _text(payload.get("valuation", "all"), "valuation", 30)
    period = _text(payload.get("range", "7d"), "range", 10)
    view = _text(payload.get("view", ""), "view", 30)
    screen = _text(payload.get("screen", "home"), "screen", 30)
    if screen not in _SCREEN_BY_ID:
        raise ValueError("Unsupported mobile screen")
    if template == "sector" and not sector:
        sector = "digital-assets" if code == "crypto" else "technology"
    rows = valuation_assets(code, view, sector, asset_type, period, valuation, payload.get("sort", "valuation"))
    symbols = payload.get("symbols", [payload["symbol"]] if payload.get("symbol") else [])
    if not isinstance(symbols, list) or len(symbols) > 30:
        raise ValueError("symbols must be a list of at most 30 asset symbols")
    symbols = [_text(s, "symbol", 30).upper() for s in symbols]
    if symbols:
        lookup = {a["symbol"].upper(): a for a in rows}
        if any(s not in lookup for s in symbols) or len(symbols) != len(set(symbols)):
            raise ValueError("Symbols must be distinct assets matching the selected market and filters")
        rows = [lookup[s] for s in symbols]
    if template == "asset-detail":
        if not rows:
            raise ValueError("Asset detail requires a matching asset")
        rows = rows[:1]
    if template == "comparison":
        if len(rows) < 2:
            raise ValueError("Comparison requires at least two matching assets")
        rows = rows[:2]
    portfolio = _portfolio(payload.get("holdings"), code) if template in ("portfolio-research", "investor-dashboard") else None
    if portfolio:
        rows = portfolio["positions"]
    topic = _text(payload.get("topic", payload.get("theme")), "topic", 140)
    title = _text(payload.get("title"), "title", 160) or _default_title(template, country, rows, sector, valuation, topic, screen)
    slug = _slug(_text(payload.get("slug"), "slug", 100) or title)
    default_path = {
        "market-ranking": "/research/" + code + "/" + slug,
        "asset-detail": _asset_url(rows[0]) if rows else "/markets/" + code,
        "sector": "/research/" + code + "/" + slug,
        "trend": "/trends/" + code + "/" + slug,
        "comparison": "/compare/" + code + "/" + "-vs-".join(_slug(a["symbol"]) for a in rows[:2]),
        "portfolio-research": "/workspace/risk",
        "education": "/learn/" + code + "/" + slug,
        "landing": "/research/" + code + "/" + slug,
        "campaign": "/campaigns/" + slug,
        "app-screen": "/app/" + screen,
        "investor-dashboard": "/workspace/overview",
        "newsletter": "/research/" + code + "/" + slug,
    }[template]
    path = _text(payload.get("path"), "path", 250) or default_path
    if not re.fullmatch(r"/(?:[a-zA-Z0-9._~%-]+/)*[a-zA-Z0-9._~%-]*", path) or ".." in path:
        raise ValueError("path must be a local route without queries or traversal")
    origin = urlsplit(base_url)
    if origin.scheme not in ("http", "https") or not origin.netloc or origin.username or origin.password or origin.query or origin.fragment or origin.path not in ("", "/"):
        raise ValueError("base_url must be an HTTP(S) origin")
    canonical = base_url.rstrip("/") + path
    visibility = _TEMPLATE_BY_ID[template]["visibility"]
    if template == "app-screen":
        visibility = _SCREEN_BY_ID[screen]["visibility"]
    trends = _trend_inputs(payload.get("trendInputs"))
    overview = market_valuation(code)
    headline = "A valuation-led view of " + country
    summary = overview["summary"]
    if rows:
        lead = rows[0]
        summary += " " + lead["name"] + " leads this selected mock screen. " + lead["valuationRationale"]
    if portfolio:
        headline = portfolio["riskLevel"] + " in your selected portfolio"
        summary = "The largest position represents " + str(portfolio["largestPositionPercent"]) + "% of this mock portfolio. Sector weights and stress scenarios help frame diversification research."
    drivers = [{"label": "Relative valuation", "detail": overview["summary"]}, {"label": "Market momentum", "detail": "Compare " + period + " price changes with trading volume rather than treating momentum as a return forecast."}]
    for key, value in trends.items():
        drivers.append({"label": re.sub(r"(?<!^)(?=[A-Z])", " ", key).title(), "detail": "Supplied trend input: " + str(value), "source": "User-supplied signal; not independently verified"})
    description = "Explore " + country + " " + (asset_type or "asset") + " rankings, prices and trends with valuation screens, portfolio research, and AI-assisted analysis. Illustrative mock data."
    related = [{"label": country + " market rankings", "url": "/markets/" + code}, {"label": "Valuation rankings", "url": "/markets/" + code + "/valuation"}, {"label": "Trending assets", "url": "/markets/" + code + "/trending"}, {"label": "Research plans", "url": "/pricing"}]
    related += [{"label": a["name"] + " research", "url": a["assetUrl"]} for a in rows[:4]]
    if sector:
        related.append({"label": sector.title() + " sector", "url": "/markets/" + code + "/sectors/" + sector})
    evidence = [{"label": a["symbol"] + " mock fundamentals", "url": a["assetUrl"], "source": DATA_SOURCE, "isMock": True} for a in rows[:6]]
    columns = [{"key": k, "label": l} for k, l in [("name", "Asset"), ("price", "Price"), ("change", period + " change"), ("marketCap", "Market cap"), ("pe", "P/E"), ("pb", "P/B"), ("dividendYield", "Yield"), ("earningsGrowth", "Earnings growth"), ("valuationScore", "Valuation score"), ("valuationCategory", "Valuation screen")]]
    table_rows = [dict(a, rank=i + 1, change=a["changes"][period]) for i, a in enumerate(rows)]
    cards = [{"label": "Market valuation", "value": overview["valuationScore"], "detail": overview["valuationCategory"], "url": "/markets/" + code + "/valuation"}, {"label": "Median P/E", "value": overview["medianPe"], "detail": "Mock stocks only", "url": "/markets/" + code + "/stocks"}, {"label": "Below peer multiples", "value": overview["counts"]["undervalued"], "detail": "Relative screen", "url": "/markets/" + code + "/valuation"}, {"label": "Selected assets", "value": len(rows), "detail": "Matching your research filters", "url": "/markets/" + code}]
    cta = {"title": "Turn market research into portfolio insight", "description": "Save research, analyze portfolio risk, and revisit your thesis with Sharebajar Plus.", "label": "Explore Plus · $19/month", "href": "/pricing", "plan": "plus"}
    if template == "education":
        sections = [{"title": "Start with the market", "body": "Understand " + country + " exchanges, trading currency " + market["currency"] + ", settlement, fees, and local access rules before researching assets."}, {"title": "Read valuation in context", "body": "P/E compares price with earnings and P/B compares price with book value. Compare relevant sectors and inspect earnings quality; a low multiple alone does not establish an attractive investment."}, {"title": "Build a research habit", "body": "Use asset pages, diversification checks, position sizing, and a watchlist to record a thesis and revisit it when financial reports change."}]
    else:
        sections = [{"title": "Research thesis", "body": summary}, {"title": "What to verify next", "body": "Review current filings, market liquidity, earnings quality, portfolio concentration, and currency exposure. Treat supplied trend signals as research inputs until their sources are checked."}]
    breadcrumb = {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Home", "item": base_url.rstrip("/") + "/"}, {"@type": "ListItem", "position": 2, "name": country, "item": base_url.rstrip("/") + "/markets/" + code}, {"@type": "ListItem", "position": 3, "name": title, "item": canonical}]}
    json_ld = {"@context": "https://schema.org", "@graph": [breadcrumb, {"@type": "WebPage", "name": title, "description": description, "url": canonical, "isAccessibleForFree": visibility == "public"}, {"@type": "ItemList", "name": title + " asset screen", "numberOfItems": len(rows), "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": a["name"], "url": base_url.rstrip("/") + a["assetUrl"]} for i, a in enumerate(rows)]}]}
    screen_id = screen if template == "app-screen" else "portfolio" if portfolio else "asset-detail" if template == "asset-detail" else "rankings"
    app_screen = {"screenId": screen_id, "title": title, "platforms": ["ios", "android", "web"], "marketCode": code, "visibility": visibility,
                  "designSystem": DESIGN_SYSTEM, "header": {"brand": "Sharebajar", "marketSelector": True, "search": True},
                  "components": ["market-selector", "research-hero", "market-cards", "asset-cards", "ranking-list", "research-summary", "plan-cta"],
                  "bottomNavigation": [{"label": "Markets", "route": "/markets/" + code}, {"label": "Research", "route": "/research"}, {"label": "Watchlist", "route": "/workspace/watchlist", "requiresAuth": True}, {"label": "Portfolio", "route": "/workspace/overview", "requiresAuth": True}],
                  "api": {"market": "/api/financial/valuation?market=" + code, "research": "/api/financial/page", "authentication": "shared-account-session"}, "pricing": deepcopy(PRICING)}
    screen_components={
        'onboarding':['brand','financial-value-proposition','choose-market-cta'],
        'choose-market':['searchable-market-list','locale-suggestion','manual-choice'],
        'home':['market-selector','market-valuation','asset-cards','research-links'],
        'search':['market-selector','asset-search','asset-results'],
        'rankings':['market-selector','valuation-filters','ranking-list'],
        'asset-detail':['asset-price','valuation-metrics','price-context','watchlist-cta','research-cta'],
        'watchlist':['account-gate','saved-asset-list','add-remove-watchlist'],
        'portfolio-import':['account-plan-gate','csv-import','demo-sync'],
        'portfolio':['account-plan-gate','currency-totals','holdings','concentration-analysis'],
        'ai-chat':['account-plan-gate','prompt-input','research-templates','save-report'],
        'forecast':['account-pro-gate','currency-scenarios','assumption-disclosure'],
        'alerts':['account-plan-gate','threshold-form','in-app-alert-list'],
        'saved-reports':['account-plan-gate','report-list','pro-export'],
        'pricing':['free-plan','plus-plan','pro-plan','subscription-cta'],
        'profile':['account-gate','market-preference','risk-style','horizon','sign-out']}
    app_screen['components']=screen_components[screen_id]
    app_screen['requiresAuth']=visibility=='private'
    app_screen['api'].update(workspace='/api/growth/state',action='/api/growth/action',account='/api/account')
    return {"schemaVersion": SCHEMA_VERSION, "id": template + ":" + code + ":" + slug, "template": template, "visibility": visibility,
            "designSystem": DESIGN_SYSTEM, "market": market, "marketCode": code, "title": title, "metaDescription": description,
            "path": path, "canonicalUrl": canonical, "seo": {"title": title + " | Sharebajar", "description": description, "canonical": canonical, "robots": "index,follow" if visibility == "public" else "noindex,nofollow"},
            "hero": {"eyebrow": "AI-assisted financial research · Mock preview", "title": title, "description": "Research " + country + " through valuation, market trends, and portfolio context."},
            "rankingTable": {"columns": columns, "rows": table_rows, "period": period, "currency": market["currency"], "valuation": valuation},
            "marketCards": cards, "assetCards": deepcopy(table_rows[:4]), "marketValuation": overview,
            "researchSummary": {"headline": headline, "summary": summary, "drivers": drivers, "risks": deepcopy(_LIMITATIONS), "methodology": overview["methodology"], "evidence": evidence, "engine": "deterministic-financial-template"},
            "sections": sections, "relatedLinks": related, "jsonLd": json_ld, "cta": cta,
            "mobileLayout": {"maxWidth": 480, "columns": 1, "tablePresentation": "asset-cards-with-expandable-metrics", "stickyMarketSelector": True, "bottomNavigation": True, "componentOrder": ["header", "hero", "marketCards", "rankingTable", "researchSummary", "relatedLinks", "cta"]},
            "appScreen": app_screen, "portfolio": portfolio, "trendInputs": trends, "isMock": True, "dataSource": DATA_SOURCE,
            "generationMode": "structured-template", "limitations": deepcopy(_LIMITATIONS)}


def generated_page_paths():
    """Return stable public and private sample route -> generation input mappings.

    Consumers exclude private templates and private mobile screens from sitemap.
    No portfolio or user-generated report should become a public SEO document.
    """
    samples = [
        ("/research/nepal/top-stocks", {"template": "market-ranking", "marketCode": "nepal", "assetType": "stocks", "title": "Top Stocks in Nepal"}),
        ("/trends/us/ai-stocks", {"template": "trend", "marketCode": "us", "sector": "technology", "title": "Best AI Stocks in the US", "trendInputs": {"sectorMomentum": {"technology": 8.4}, "catalysts": ["Illustrative AI infrastructure earnings theme"]}}),
        ("/research/crypto/top-crypto-by-volume", {"template": "market-ranking", "marketCode": "crypto", "sort": "volume", "title": "Top Crypto Assets by Volume"}),
        ("/research/india/undervalued-banking-stocks", {"template": "sector", "marketCode": "india", "sector": "financials", "valuation": "undervalued", "title": "Undervalued Banking Stocks in India"}),
        ("/compare/us/aapl-vs-msft", {"template": "comparison", "marketCode": "us", "symbols": ["AAPL", "MSFT"], "title": "Apple vs Microsoft Stock Comparison"}),
        ("/research/us/long-term-etfs", {"template": "market-ranking", "marketCode": "us", "assetType": "etfs", "title": "Best ETFs for Long-Term Investors"}),
        ("/trends/us/trending-assets-this-week", {"template": "trend", "marketCode": "us", "view": "trending", "title": "Trending Assets This Week"}),
        ("/research/us/high-dividend-stocks", {"template": "market-ranking", "marketCode": "us", "assetType": "stocks", "valuation": "dividend", "title": "High Dividend Stocks by Market"}),
        ("/learn/nepal/beginner-guide-to-nepse", {"template": "education", "marketCode": "nepal", "title": "Beginner Guide to NEPSE"}),
        ("/workspace/risk", {"template": "portfolio-research", "marketCode": "us", "title": "Portfolio Risk Report"}),
        ("/research/crypto/market-forecast", {"template": "trend", "marketCode": "crypto", "title": "Crypto Market Forecast", "trendInputs": {"cryptoNarratives": ["Illustrative liquidity rotation"], "etfFlows": 12500000}}),
        ("/research/us/sector-rotation", {"template": "sector", "marketCode": "us", "title": "Sector Rotation Report", "trendInputs": {"sectorMomentum": {"technology": 8.4, "energy": -2.1, "financials": 3.2}}}),
        ("/asset/us/AAPL", {"template": "asset-detail", "marketCode": "us", "symbols": ["AAPL"]}),
        ("/research/us/investment-research", {"template": "landing", "marketCode": "us", "title": "AI-Powered Investment Research"}),
        ("/campaigns/dividend-research", {"template": "campaign", "marketCode": "us", "valuation": "dividend", "title": "Research Your Dividend Strategy"}),
        ("/app/onboarding", {"template": "app-screen", "screen": "onboarding", "marketCode": "us"}),
        ("/workspace/overview", {"template": "investor-dashboard", "marketCode": "us"}),
        ("/research/us/weekly-market-brief", {"template": "newsletter", "marketCode": "us", "title": "US Weekly Market Newsletter"}),
    ]
    return {path: dict(payload, path=path) for path, payload in samples}

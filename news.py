"""Market headlines from Google News RSS; publisher metadata stays attached."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import threading
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
from catalog import ASSETS
from providers import DataUnavailable

MARKETS=sorted({a['country'] for a in ASSETS if a['type']=='Indexes' and a['country'] not in {'Europe','Global'}})
_cache={}
_lock=threading.Lock()
NEWS_CATEGORIES={
    'all':('Top stories','financial markets economy'),
    'stocks':('Stocks','stock markets equities'),
    'etfs':('ETFs','exchange traded funds ETF'),
    'crypto':('Crypto','bitcoin cryptocurrency digital assets'),
    'economy':('Economy','economy inflation employment GDP'),
    'central-banks':('Central banks','central bank interest rates monetary policy'),
    'bonds':('Bonds','bonds treasury yields fixed income'),
    'currencies':('Currencies','foreign exchange currencies forex'),
    'commodities':('Commodities','commodity markets agriculture'),
    'energy':('Energy','oil natural gas energy markets'),
    'metals':('Metals','gold silver copper metals markets'),
    'technology':('Technology','technology semiconductor artificial intelligence business'),
    'earnings':('Earnings','corporate earnings revenue results'),
    'business':('Business','companies mergers acquisitions business'),
    'politics':('Politics','politics economic policy trade tariffs'),
    'geopolitics':('Geopolitics','geopolitics international trade sanctions'),
    'real-estate':('Real estate','real estate housing property markets'),
    'healthcare':('Healthcare','healthcare pharmaceutical biotech business'),
    'industrials':('Industrials','industrial manufacturing aerospace business'),
    'sustainability':('Climate & ESG','climate sustainable finance renewable energy'),
    'personal-finance':('Personal finance','personal finance retirement investing'),
    'emerging-markets':('Emerging markets','emerging markets developing economies stocks'),
}


def category_news(category,market='Global'):
    if category not in NEWS_CATEGORIES or market not in ['Global',*MARKETS]:raise ValueError('Choose a supported news category and market')
    title,query=NEWS_CATEGORIES[category]
    if market!='Global':query=market+' '+query
    return dict(fetch_headlines(query+' when:1d',market),category=category,categoryTitle=title,window='Last 24 hours',ordering='Newest first')

def safe_link(value):
    value=(value or '').strip()
    try:
        url=urlsplit(value)
        return value if url.scheme=='https' and url.hostname and not url.username and not url.password else ''
    except ValueError:
        return ''

def normalize_news(xml):
    if b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper():
        raise DataUnavailable('The news feed could not be processed.')
    try: root=ET.fromstring(xml)
    except ET.ParseError as exc: raise DataUnavailable('The news feed could not be processed.') from exc
    if root.tag!='rss' or root.find('channel') is None:
        raise DataUnavailable('The news feed could not be processed.')
    items=[]; seen=set()
    for item in root.findall('./channel/item'):
        title=(item.findtext('title') or '').strip()
        link=safe_link(item.findtext('link'))
        source=item.find('source')
        publisher=(source.text or '').strip() if source is not None else ''
        if not title or not link or not publisher: continue
        suffix=' - '+publisher
        if title.endswith(suffix): title=title[:-len(suffix)]
        published=None
        try:
            date=parsedate_to_datetime(item.findtext('pubDate') or '')
            published=date.replace(tzinfo=date.tzinfo or timezone.utc).astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError, OverflowError): pass
        key=(title.casefold(),publisher.casefold())
        if link in seen or key in seen: continue
        seen.update([link,key])
        items.append(dict(title=title[:350],url=link,publisher=publisher[:120],
                          publisherUrl=safe_link(source.get('url')),publishedAt=published))
    items.sort(key=lambda item:item['publishedAt'] or '',reverse=True)
    return items[:8]

def market_news(market):
    if market not in MARKETS: raise ValueError('Unknown market')
    query=('NEPSE Nepal stock market' if market=='Nepal' else market+' stock market')+' when:7d'
    return fetch_headlines(query,market)

def asset_news(name,symbol):
    return fetch_headlines(f'"{name[:80]}" "{symbol[:40]}" finance when:7d',symbol)


def today_news(market,start,end):
    if market not in MARKETS:raise ValueError('Unknown market')
    begin=datetime.fromisoformat(start.replace('Z','+00:00'))
    finish=datetime.fromisoformat(end.replace('Z','+00:00'))
    if begin.tzinfo is None or finish.tzinfo is None or not 22*3600<=(finish-begin).total_seconds()<=26*3600:
        raise ValueError('Choose a valid local day')
    query=('NEPSE Nepal stock market' if market=='Nepal' else market+' stock market')+' when:1d'
    feed=fetch_headlines(query,market)
    articles=[]
    for article in feed['articles']:
        try:
            published=datetime.fromisoformat((article.get('publishedAt') or '').replace('Z','+00:00'))
            if published.tzinfo and begin<=published<finish:articles.append(article)
        except ValueError:continue
    return dict(feed,articles=articles,start=begin.isoformat(),end=finish.isoformat(),ordering='Newest first')

def fetch_headlines(query,market):
    with _lock:
        cached=_cache.get(query)
        if cached and time.monotonic()-cached[0]<300: return cached[1]
    feed='https://news.google.com/rss/search?'+urlencode({'q':query,'hl':'en-US','gl':'US','ceid':'US:en'})
    try:
        request=Request(feed,headers={'User-Agent':'ShareBajar/0.1 (market headlines)', 'Accept':'application/rss+xml, application/xml'})
        with urlopen(request,timeout=12) as response: xml=response.read(2_000_001)
        if len(xml)>2_000_000: raise DataUnavailable('The news feed could not be processed.')
        articles=normalize_news(xml)
    except DataUnavailable: raise
    except Exception as exc: raise DataUnavailable('Market news is unavailable from Google News. Retry later.') from exc
    result=dict(market=market,articles=articles,source='Google News RSS',feedUrl=feed,
                fetchedAt=datetime.now(timezone.utc).isoformat())
    with _lock:
        if len(_cache)>200:_cache.clear()
        _cache[query]=(time.monotonic(),result)
    return result

"""Replaceable market-data adapters; no fabricated quote fallback."""
import json, math, time, threading
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode, quote
from urllib.parse import urlsplit
from typing import Protocol
from market_db import cache_get,cache_put,provider_failure
class DataUnavailable(Exception): pass
class CryptoDataProvider(Protocol):
    def get_assets(self, page: int = 1): ...
    def get_asset(self, asset: str): ...
    def get_markets(self, asset: str): ...
    def get_exchanges(self, page: int = 1): ...
    def get_exchange(self, exchange: str): ...
    def get_ohlc(self, asset: str, days: int): ...
_request_locks=[threading.Lock() for _ in range(64)]
def request_json(url, ttl=120):
    import hashlib
    lock=_request_locks[hashlib.sha256(url.encode()).digest()[0]%len(_request_locks)]
    with lock:return fetch_json(url,ttl)

def fetch_json(url,ttl):
    host=urlsplit(url).hostname
    provider={'query1.finance.yahoo.com':'yahoo','api.coingecko.com':'coingecko','www.alphavantage.co':'alphavantage','api.frankfurter.dev':'frankfurter'}.get(host)
    if not provider:raise DataUnavailable('The requested market-data provider is not configured.')
    cached=cache_get(url,ttl)
    if cached is not None:return cached
    try:
        req = Request(url, headers={'User-Agent':'ShareBajar/0.1 (market research)', 'Accept':'application/json'})
        with urlopen(req, timeout=12) as response: raw=response.read(8_000_001)
        if len(raw)>8_000_000:raise ValueError('Provider response too large')
        def reject_constant(value):raise ValueError('Non-finite provider value')
        data=json.loads(raw,parse_constant=reject_constant)
        if isinstance(data,dict) and (data.get('error') or data.get('Error Message') or data.get('Note') or data.get('Information') or data.get('chart',{}).get('error')):raise ValueError('Provider data unavailable')
    except HTTPError as exc:
        messages={403:'The provider or network policy denied market-data access.',429:'The market-data provider rate limit was reached. Retry later.',401:'This provider requires authorized API access.'}
        message=messages.get(exc.code,'The market-data provider returned an error.');provider_failure(provider,message)
        raise DataUnavailable(message) from exc
    except Exception as exc:
        message='Market data is unavailable from this provider. Retry later.';provider_failure(provider,message)
        raise DataUnavailable(message) from exc
    cache_put(url,provider,data,ttl)
    return data

def normalize_chart(data, symbol):
    result = data.get('chart',{}).get('result')
    if not result: raise DataUnavailable('This instrument is not covered by the provider.')
    item=result[0]; meta=item.get('meta',{})
    price=meta.get('regularMarketPrice'); previous=meta.get('chartPreviousClose',meta.get('previousClose'))
    if not isinstance(price,(float,int)) or not math.isfinite(price): raise DataUnavailable('No valid quote supplied.')
    timestamps=item.get('timestamp',[])
    indicators=item.get('indicators',{}).get('quote',[{}])[0]
    points=[{'time':t,'value':v} for t,v in zip(timestamps,indicators.get('close',[])) if isinstance(v,(int,float)) and math.isfinite(v)]
    sessions=meta.get('currentTradingPeriod',{}).get('regular',{})
    now=time.time()
    status=('Open' if sessions['start']<=now<sessions['end'] else 'Closed') if sessions.get('start') and sessions.get('end') else 'Not supplied'
    return dict(symbol=symbol,price=price,previousClose=previous,change=price-previous if previous is not None else None,changePercent=(price/previous-1)*100 if previous else None,currency=meta.get('currency'),updatedAt=meta.get('regularMarketTime'),status=status,history=points,source='Yahoo Finance',delayMinutes=meta.get('exchangeDataDelayedBy'),rangeStart=points[0]['value'] if points else None)
class YahooProvider:
    def quote(self,symbol,period='1d'):
        if symbol in ['NEPSE','DSEX','NGXASI','NSE20','MASI']:
            raise DataUnavailable('A licensed regional data adapter is required for this market.')
        interval={'1h':'2m','7d':'30m','1d':'5m','5d':'30m','1mo':'1d','3mo':'1d','1y':'1wk','5y':'1mo','max':'1mo'}[period]
        url='https://query1.finance.yahoo.com/v8/finance/chart/'+quote(symbol,safe='')+'?'+urlencode({'range':{'1h':'1d','7d':'5d'}.get(period,period),'interval':interval})
        result=normalize_chart(request_json(url),symbol)
        # chartPreviousClose on long ranges is a range baseline, not yesterday's close.
        if period!='1d':
            daily=self.quote(symbol,'1d')
            result.update({key:daily[key] for key in ['price','previousClose','change','changePercent','updatedAt','status','delayMinutes']})
        if period=='1h' and result['history']:
            end=result['history'][-1]['time']
            result['history']=[p for p in result['history'] if p['time']>=end-3600]
        return result
    def search(self,query):
        data=request_json('https://query1.finance.yahoo.com/v1/finance/search?'+urlencode({'q':query,'quotesCount':15,'newsCount':0}))
        kinds={'EQUITY':'Stocks','ETF':'ETFs','INDEX':'Indexes','CURRENCY':'Forex','FUTURE':'Commodities'}
        return [dict(id=q['symbol'],symbol=q['symbol'],name=q.get('longname',q.get('shortname',q['symbol'])),exchange=q.get('exchDisp',''),type=kinds[q['quoteType']],country='Provider directory',region='World',currency='') for q in data.get('quotes',[]) if q.get('quoteType') in kinds and q.get('symbol')]
class CoinGeckoProvider:
    base='https://api.coingecko.com/api/v3'
    def get(self,path,params=None): return request_json(self.base+path+('?' + urlencode(params) if params else ''),180)
    def get_assets(self,page=1): return self.get('/coins/markets',{'vs_currency':'usd','order':'market_cap_desc','per_page':50,'page':page,'sparkline':'true','price_change_percentage':'7d,30d'})
    def get_asset(self,asset): return self.get('/coins/'+quote(asset,safe=''),{'localization':'false','tickers':'false','community_data':'false','developer_data':'false'})
    def verify_exchanges(self, ids):
        def verify(exchange):
            try: return self.get_exchange(exchange)
            except DataUnavailable: return None
        with ThreadPoolExecutor(max_workers=3) as pool:
            return [item for item in pool.map(verify,ids) if item]
    def get_markets(self,asset):
        data=self.get('/coins/'+quote(asset,safe='')+'/tickers',{'order':'volume_desc'})
        ticks=data.get('tickers',[])
        # Classification is supplied by exchange detail, not by the directory response.
        ids=list(dict.fromkeys(t.get('market',{}).get('identifier') for t in ticks if t.get('market',{}).get('identifier')))[:8]
        centralized={e['id'] for e in self.verify_exchanges(ids)}
        if ids and not centralized: raise DataUnavailable('Centralized exchange classification is unavailable. Retry later.')
        return dict(data,tickers=[t for t in ticks if t.get('market',{}).get('identifier') in centralized],coverageNote='Listings are limited to eight venues verified through provider exchange details. Unclassified exchanges are omitted.')
    def get_exchanges(self,page=1):
        entries=self.get('/exchanges',{'per_page':10,'page':page})
        verified={e['id']:e for e in self.verify_exchanges([e['id'] for e in entries])}
        if entries and not verified: raise DataUnavailable('Centralized exchange classification is unavailable. Retry later.')
        return [dict(e,centralized=True) for e in entries if e['id'] in verified]
    def get_exchange(self,exchange):
        data=request_json(self.base+'/exchanges/'+quote(exchange,safe=''),3600)
        if data.get('centralized') is not True: raise DataUnavailable('This exchange is not classified as centralized by the provider.')
        return dict(data,id=exchange)
    def get_ohlc(self,asset,days): return self.get('/coins/'+quote(asset,safe='')+'/market_chart',{'vs_currency':'usd','days':days})
    def search(self,query): return self.get('/search',{'query':query}).get('coins',[])
    def quote(self,asset,days=1):
        data=self.get_asset(asset); market=data['market_data']; history=self.get_ohlc(asset,days)
        price=market['current_price'].get('usd')
        if price is None: raise DataUnavailable('No USD quote supplied.')
        change=market.get('price_change_24h'); percent=market.get('price_change_percentage_24h')
        return dict(symbol=data['symbol'].upper(),price=price,currency='USD',change=change,changePercent=percent,previousClose=price-change if change is not None else None,status='24/7',updatedAt=data.get('last_updated'),source='CoinGecko',history=[{'time':t/1000,'value':v} for t,v in history.get('prices',[])],marketCap=market.get('market_cap',{}).get('usd'),volume=market.get('total_volume',{}).get('usd'),supply=market.get('circulating_supply'),totalSupply=market.get('total_supply'),ath=market.get('ath',{}).get('usd'),change7d=market.get('price_change_percentage_7d'),change30d=market.get('price_change_percentage_30d'))

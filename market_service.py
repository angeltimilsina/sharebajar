"""One canonical API/service for every asset class and provider-backed quote."""
import hashlib,math,threading,time
from asset_store import get_asset,upsert_assets,list_assets,mapping,get_quote,put_quote,quote_failure,update_currency,validate_id
from providers import YahooProvider,CoinGeckoProvider,DataUnavailable
from membership import AppError
from market_db import database,now,encode
_LOCKS=[threading.Lock() for _ in range(64)]
PERIODS={'1h':1,'1d':1,'5d':7,'7d':7,'1mo':30,'3mo':90,'1y':365,'5y':1825,'max':'max'}

def crypto_metadata(item):
    identifier=item.get('providerId') or item['id'];identifier=identifier[7:] if identifier.startswith('crypto:') else identifier
    return dict(id='crypto:'+identifier,providerId=identifier,name=item['name'],symbol=item['symbol'].upper(),type='Crypto',currency='USD',country='Global',region='World',exchange='CoinGecko')

def resolve_asset(identifier):
    validate_id(identifier);asset=get_asset(identifier)
    if asset:return asset
    if identifier.startswith('cash:'):
        currency=identifier[5:]
        return upsert_assets([dict(id=identifier,name=currency+' Cash',symbol=currency,type='Cash',currency=currency,country='Cash',region='World',exchange='Cash')],'internal')[0]
    if identifier.startswith('crypto:'):
        data=CoinGeckoProvider().get_asset(identifier[7:]);data=dict(data,id=identifier)
        return upsert_assets([crypto_metadata(data)],'coingecko')[0]
    results=YahooProvider().search(identifier)
    matched=next((a for a in results if a['id'].upper()==identifier.upper()),None)
    if not matched:raise AppError('This asset is not covered by the provider.',404,'asset_not_found')
    return upsert_assets([matched],'yahoo')[0]

def search(query,kind=''):
    local=list_assets(query=query,kind=kind,limit=100);warnings=[]
    try:
        matches=YahooProvider().search(query)
        if kind:matches=[a for a in matches if a['type']==kind]
        local+=upsert_assets(matches,'yahoo')
    except DataUnavailable:warnings.append('Security discovery is unavailable; showing central catalog matches.')
    if not kind or kind=='Crypto':
        try:local+=upsert_assets([crypto_metadata(a) for a in CoinGeckoProvider().search(query)],'coingecko')
        except DataUnavailable:warnings.append('Crypto discovery is unavailable; showing central catalog matches.')
    return dict(assets=list({a['id']:a for a in local}.values()),warnings=warnings)

def crypto_assets(page=1):
    entries=CoinGeckoProvider().get_assets(page)
    canonical=upsert_assets([crypto_metadata(a) for a in entries],'coingecko');by_id={a['id']:a for a in canonical}
    # Volatile listing metrics accompany, but never overwrite, canonical metadata.
    return [dict(a,**by_id['crypto:'+a['id']],providerId=a['id']) for a in entries]

def quote(identifier,period='1d'):
    if period not in PERIODS:raise AppError('Invalid quote timeframe.')
    asset=resolve_asset(identifier);identifier=asset['id']
    key=hashlib.sha256((identifier+period).encode()).digest()[0]%len(_LOCKS)
    with _LOCKS[key]:
        cached=get_quote(identifier,period)
        if cached:return cached
        instrument=mapping(asset,'quote')
        if not instrument:raise DataUnavailable('No price provider is configured for this asset.')
        try:
            provider=instrument['provider'];symbol=instrument['symbol']
            if provider=='internal':data=dict(symbol=asset['symbol'],price=1,currency=asset['currency'],change=0,changePercent=0,previousClose=1,status='Cash face value',updatedAt=None,source='Cash face value',history=[])
            elif provider=='coingecko':data=CoinGeckoProvider().quote(symbol,PERIODS[period])
            elif provider=='yahoo':data=YahooProvider().quote(symbol,period)
            else:raise DataUnavailable('The mapped quote adapter is unavailable.')
            if not isinstance(data.get('price'),(int,float)) or not math.isfinite(data['price']):raise DataUnavailable('The provider returned no usable quote.')
            if period=='1h' and provider=='coingecko' and data.get('history'):
                end=data['history'][-1]['time'];data['history']=[p for p in data['history'] if p['time']>=end-3600]
            update_currency(identifier,data.get('currency'))
            return put_quote(identifier,period,dict(data,provider=provider),86400 if provider=='internal' else 180 if provider=='coingecko' else 120)
        except DataUnavailable as exc:
            quote_failure(identifier,period,str(exc));old=get_quote(identifier,period,allow_expired=True)
            if old:return old
            raise

def one_quote(identifier,period='1d'):
    try:return quote(identifier,period)
    except (DataUnavailable,AppError) as exc:return dict(id=identifier,error=str(exc),stale=False,available=False)

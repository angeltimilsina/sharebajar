import math
import os
from urllib.parse import urlencode
from providers import request_json, DataUnavailable

FIELDS=['MarketCapitalization','PERatio','ForwardPE','PEGRatio','PriceToBookRatio','EPS','RevenueTTM',
        'EBITDA','ProfitMargin','OperatingMarginTTM','ReturnOnEquityTTM','DividendYield',
        'QuarterlyRevenueGrowthYOY','QuarterlyEarningsGrowthYOY','52WeekHigh','52WeekLow','Beta']

def normalize_fundamentals(data,symbol):
    if data.get('Symbol','').upper()!=symbol.upper():raise DataUnavailable('Company fundamentals are unavailable for this listing.')
    metrics={}
    for field in FIELDS:
        try:value=float(data.get(field,''))
        except (TypeError,ValueError):continue
        if math.isfinite(value):metrics[field]=value
    if not metrics:raise DataUnavailable('No usable fundamentals were supplied by the provider.')
    return dict(metrics=metrics,asOf=data.get('LatestQuarter'),currency=data.get('Currency'),
                sector=data.get('Sector'),industry=data.get('Industry'),source='Alpha Vantage',
                sourceUrl='https://www.alphavantage.co/documentation/#company-overview')

def company_fundamentals(asset):
    if asset['type']!='Stocks':raise DataUnavailable('Company fundamentals do not apply to this asset type.')
    if asset.get('exchange') not in ['NASDAQ','NasdaqGS','NasdaqGM','NasdaqCM','NYSE','NYSE American']:
        raise DataUnavailable('Fundamental data coverage is not configured for this exchange.')
    key=os.environ.get('ALPHAVANTAGE_API_KEY')
    if not key:raise DataUnavailable('A company fundamentals provider is not configured.')
    data=request_json('https://www.alphavantage.co/query?'+urlencode({'function':'OVERVIEW','symbol':asset['symbol'],'apikey':key}),3600)
    return normalize_fundamentals(data,asset['symbol'])

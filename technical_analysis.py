"""Provider-backed OHLC candles, deterministic indicators, and historical scenario bands."""
from datetime import datetime,timezone
import math
import statistics
import time

from ai_analysis import resolve_asset
from membership import AppError
from providers import CoinGeckoProvider,DataUnavailable,request_json
from urllib.parse import quote,urlencode

RANGES={'1mo':30,'3mo':90,'1y':365}
HORIZONS={'1w':7,'1mo':30,'3mo':90}


def _number(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)


def candles_for(asset):
    if asset['type']=='Crypto':
        coin_id=asset['id'][7:]
        raw=CoinGeckoProvider().get('/coins/'+quote(coin_id,safe='')+'/ohlc',{'vs_currency':'usd','days':365})
        source='CoinGecko'
        rows=raw if isinstance(raw,list) else []
        candles=[]
        for row in rows:
            if not isinstance(row,list) or len(row)<5:continue
            timestamp,open_,high,low,close=row[:5]
            if not all(_number(v) for v in (timestamp,open_,high,low,close)) or min(open_,high,low,close)<=0 or high<max(open_,close) or low>min(open_,close):continue
            candles.append({'time':int(timestamp/1000),'open':float(open_),'high':float(high),'low':float(low),'close':float(close),'volume':None})
        url='https://www.coingecko.com/en/coins/'+quote(coin_id,safe='')
    else:
        if asset['id'] in ('NEPSE','DSEX','NGXASI','NSE20','MASI'):
            raise DataUnavailable('A licensed regional data adapter is required for this market.')
        url='https://query1.finance.yahoo.com/v8/finance/chart/'+quote(asset['id'],safe='')+'?'+urlencode({'range':'1y','interval':'1d'})
        raw=request_json(url,180)
        items=raw.get('chart',{}).get('result')
        if not items:raise DataUnavailable('Historical OHLC candles are unavailable for this asset.')
        item=items[0];quote_data=item.get('indicators',{}).get('quote',[{}])[0];timestamps=item.get('timestamp',[])
        candles=[]
        for index,timestamp in enumerate(timestamps):
            values=[quote_data.get(key,[])[index] if index<len(quote_data.get(key,[])) else None for key in ('open','high','low','close','volume')]
            open_,high,low,close,volume=values
            if not _number(timestamp) or not all(_number(v) for v in (open_,high,low,close)):continue
            if min(open_,high,low,close)<=0 or high<max(open_,close) or low>min(open_,close):continue
            candles.append({'time':int(timestamp),'open':float(open_),'high':float(high),'low':float(low),'close':float(close),'volume':float(volume) if _number(volume) and volume>=0 else None})
        source='Yahoo Finance'
    candles.sort(key=lambda candle:candle['time'])
    deduplicated={candle['time']:candle for candle in candles}
    candles=list(deduplicated.values())
    if len(candles)<2:raise DataUnavailable('The provider returned insufficient OHLC candle history.')
    return {'asset':asset,'candles':candles,'source':source,'url':url,'fetchedAt':datetime.now(timezone.utc).isoformat()}


def _series(candles,key):
    return [{'time':candle['time'],'value':value} for candle,value in zip(candles,key) if value is not None and _number(value)]


def _sma(values,period):
    result=[None]*len(values)
    for index in range(period-1,len(values)):
        window=values[index-period+1:index+1]
        result[index]=sum(window)/period
    return result


def _ema(values,period):
    alpha=2/(period+1)
    result=[];average=None
    for value in values:
        average=value if average is None else alpha*value+(1-alpha)*average
        result.append(average)
    return result


def _rsi(values,period=14):
    result=[None]*len(values)
    if len(values)<=period:return result
    gains=[max(values[i]-values[i-1],0) for i in range(1,len(values))]
    losses=[max(values[i-1]-values[i],0) for i in range(1,len(values))]
    average_gain=sum(gains[:period])/period;average_loss=sum(losses[:period])/period
    def score(gain,loss):
        if loss==0:return 50 if gain==0 else 100
        return 100-100/(1+gain/loss)
    result[period]=score(average_gain,average_loss)
    for index in range(period+1,len(values)):
        average_gain=(average_gain*(period-1)+gains[index-1])/period
        average_loss=(average_loss*(period-1)+losses[index-1])/period
        result[index]=score(average_gain,average_loss)
    return result


def _indicators(candles):
    closes=[candle['close'] for candle in candles]
    middle=_sma(closes,20);upper=[None]*len(closes);lower=[None]*len(closes)
    for index in range(19,len(closes)):
        deviation=statistics.pstdev(closes[index-19:index+1])
        upper[index]=middle[index]+2*deviation;lower[index]=middle[index]-2*deviation
    ema12=_ema(closes,12);ema26=_ema(closes,26)
    macd=[left-right for left,right in zip(ema12,ema26)]
    signal=_ema(macd,9)
    histogram=[value-average for value,average in zip(macd,signal)]
    return {
        'sma20':_series(candles,middle),
        'sma50':_series(candles,_sma(closes,50)),
        'sma200':_series(candles,_sma(closes,200)),
        'ema20':_series(candles,_ema(closes,20)),
        'bollingerUpper':_series(candles,upper),
        'bollingerLower':_series(candles,lower),
        'rsi14':_series(candles,_rsi(closes)),
        'macd':_series(candles,macd),
        'macdSignal':_series(candles,signal),
        'macdHistogram':_series(candles,histogram),
    }


def scenario_projection(candles,horizon,crypto=False):
    if horizon not in HORIZONS:raise AppError('Choose a supported projection horizon.')
    closes=[candle['close'] for candle in candles]
    returns=[math.log(current/previous) for previous,current in zip(closes,closes[1:])][-90:]
    if len(returns)<20:
        return {'horizon':horizon,'available':False,'reason':'At least 20 valid daily returns are required.'}
    periods=HORIZONS[horizon] if crypto else {'1w':5,'1mo':21,'3mo':63}[horizon]
    mean=statistics.mean(returns);deviation=statistics.stdev(returns)
    center=math.log(closes[-1])+mean*periods
    spread=1.96*deviation*math.sqrt(periods)
    last=candles[-1]['time']
    future=last+HORIZONS[horizon]*86400
    try:
        lower=math.exp(center-spread);median=math.exp(center);upper=math.exp(center+spread)
    except OverflowError:
        return {'horizon':horizon,'available':False,'reason':'The historical volatility range is too wide for a stable scenario display.'}
    return {
        'horizon':horizon,'available':True,'historicalReturns':len(returns),
        'current':closes[-1],'median':median,'lower':lower,'upper':upper,
        'observedVolatilityPercent':deviation*100,'time':last,'futureTime':future,
        'assumption':'Historical daily log-return mean and volatility; 95% normal scenario band, not a target or forecast.',
    }


def build_technicals(asset_id,chart_range='3mo',horizon='1mo',include_indicators=True):
    if chart_range not in RANGES:raise AppError('Choose a supported chart range.')
    if include_indicators and horizon not in HORIZONS:raise AppError('Choose a supported projection horizon.')
    asset=resolve_asset(asset_id)
    data=candles_for(asset)
    all_candles=data['candles']
    cutoff=all_candles[-1]['time']-RANGES[chart_range]*86400
    selected=[candle for candle in all_candles if candle['time']>=cutoff]
    result={'asset':asset,'candles':selected,'source':data['source'],'sourceUrl':data['url'],'fetchedAt':data['fetchedAt'],'range':chart_range}
    if include_indicators:
        indicators=_indicators(all_candles)
        result['indicators']={name:[point for point in points if point['time']>=cutoff] for name,points in indicators.items()}
        result['latestIndicators']={name:points[-1]['value'] if points else None for name,points in indicators.items()}
        result['projection']=scenario_projection(all_candles,horizon,asset['type']=='Crypto')
    return result


def ai_evidence(technical):
    projection=technical.get('projection',{})
    return {
        'asset':{'id':technical['asset']['id'],'symbol':technical['asset']['symbol'],'name':technical['asset']['name']},
        'asOf':technical['candles'][-1]['time'] if technical.get('candles') else None,
        'indicators':technical.get('latestIndicators',{}),
        'projection':{key:value for key,value in projection.items() if key not in ('time','futureTime')},
        'limitations':['Indicators are calculations from provider OHLC data, not independently verified fundamentals.','Scenario bands are deterministic historical-return illustrations, not guaranteed outcomes or investment advice.'],
        'source':technical.get('source'),'sourceUrl':technical.get('sourceUrl'),
    }

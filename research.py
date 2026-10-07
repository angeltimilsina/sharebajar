"""Dated research evidence and deterministic calculations; AI never supplies figures."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date,datetime,timedelta,timezone
import math,re,statistics
from urllib.parse import quote,urlencode
from catalog import ASSETS
from ai_analysis import resolve_asset,portfolio_context,generate_report,evidence_item,news_evidence
from fundamentals import company_fundamentals
from membership import AppError,require_plan,reserve_usage,effective_plan
from news import asset_news
from providers import request_json,CoinGeckoProvider,DataUnavailable

TEMPLATES={'compare','snapshot','growth','concentration','drivers','portfolio-benchmark','freeform'}
FREE={'compare','snapshot'}
INDICATORS={'price','business','volatility','volume','valuation','dividend','benchmark'}
BENCHMARKS={'United States':'^GSPC','United Kingdom':'^FTSE','India':'^NSEI','Japan':'^N225','Canada':'^GSPTSE','Germany':'^GDAXI','France':'^FCHI','Australia':'^AXJO','Hong Kong':'^HSI','China':'000001.SS'}

def requested_period(body):
    prompt=body.get('prompt','')
    if isinstance(prompt,str):
        for pattern,period in [(r'last (?:completed )?quarter','quarter'),(r'last (?:30 days|month)','1mo'),(r'last (?:90 days|three months|3 months)','3mo'),(r'last (?:365 days|year)','1y')]:
            if re.search(pattern,prompt,re.I):return period
    return body.get('timeframe','quarter')

def window_dates(period,today=None):
    today=today or datetime.now(timezone.utc).date()
    end=today-timedelta(days=1)
    if period=='quarter':
        this=date(today.year,((today.month-1)//3)*3+1,1);end=this-timedelta(days=1)
        start=date(end.year,((end.month-1)//3)*3+1,1)
    elif period in ('1mo','3mo','1y'):start=end-timedelta(days={'1mo':29,'3mo':89,'1y':364}[period])
    else:raise AppError('Choose a supported timeframe.')
    return start,end

def authorize(body,user,ip):
    template=body.get('template','freeform');period=requested_period(body)
    if template not in TEMPLATES:raise AppError('Choose an available analysis template.')
    window_dates(period)
    free=template in FREE and period=='quarter' and not body.get('prompt') and not body.get('history')
    if not free:require_plan(user,'plus')
    if free:reserve_usage('research-free:'+(user['id'] if user else ip),3)
    else:reserve_usage('ai:'+user['id'],40 if effective_plan(user)=='pro' else 10)
    return free

def finite(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
def iso(t):return datetime.fromtimestamp(t,timezone.utc).date().isoformat()
def stamp(d):return int(datetime.combine(d,datetime.min.time(),timezone.utc).timestamp())

def history(asset,start,end):
    """Raw close observations, grouped by UTC date. No rolling-range substitution."""
    begin=stamp(start-timedelta(days=8));finish=stamp(end+timedelta(days=1));crypto=asset['type']=='Crypto'
    if crypto:
        data=CoinGeckoProvider().get('/coins/'+quote(asset['id'][7:],safe='')+'/market_chart/range',{'vs_currency':'usd','from':begin,'to':finish})
        observations=[(int(t/1000),p,None) for t,p in data.get('prices',[]) if finite(t)]
        volumes=[(int(t/1000),v) for t,v in data.get('total_volumes',[]) if finite(t) and finite(v) and v>=0 and stamp(start)<=t/1000<finish]
        volume=statistics.mean(v for _,v in volumes) if volumes else None;unit='USD rolling 24h volume';currency='USD';source='CoinGecko';url='https://www.coingecko.com/en/coins/'+quote(asset['id'][7:],safe='')
    else:
        url='https://query1.finance.yahoo.com/v8/finance/chart/'+quote(asset['id'],safe='')+'?'+urlencode({'period1':begin,'period2':finish,'interval':'1d'})
        raw=request_json(url,3600);results=raw.get('chart',{}).get('result')
        if not results:raise DataUnavailable('Historical prices are unavailable for this asset.')
        item=results[0];quotes=item.get('indicators',{}).get('quote',[{}])[0];times=item.get('timestamp',[])
        closes=quotes.get('close',[]);volumes=quotes.get('volume',[])
        observations=[(t,p,volumes[i] if i<len(volumes) else None) for i,(t,p) in enumerate(zip(times,closes)) if finite(t)]
        good=[v for t,p,v in observations if stamp(start)<=t<finish and finite(p) and finite(v) and v>=0]
        # Currency and index feeds often return zero placeholder volumes; do not present these as traded volume.
        volume=statistics.mean(good) if good and any(v>0 for v in good) and asset['type'] not in ('Forex','Indexes') else None
        unit='contracts / session' if asset['type']=='Commodities' else 'shares / session';currency=item.get('meta',{}).get('currency') or asset.get('currency');source='Yahoo Finance';url='https://finance.yahoo.com/quote/'+quote(asset['id'],safe='')
    days={}
    for t,p,v in sorted(observations):
        if begin<=t<finish and finite(p) and p>0:days[iso(t)]={'time':stamp(date.fromisoformat(iso(t))),'value':p}
    return dict(points=list(days.values()),currency=currency,source=source,url=url,volume=volume,volumeUnit=unit,
                fetchedAt=datetime.now(timezone.utc).isoformat(),dataAsOf=iso(max(t for t,p,v in observations if finite(p) and p>0 and begin<=t<finish)) if days else None)

def price_metrics(points,start,end,crypto=False):
    baseline=[p for p in points if iso(p['time'])<start.isoformat()]
    selected=[p for p in points if start.isoformat()<=iso(p['time'])<=end.isoformat()]
    base=baseline[-1] if baseline else None;last=selected[-1] if selected else None
    complete=base and last and date.fromisoformat(iso(base['time']))>=start-timedelta(days=7) and date.fromisoformat(iso(last['time']))>=end-timedelta(days=7)
    result=dict(priceReturn=None,volatility=None,baselineDate=iso(base['time']) if base else None,lastDate=iso(last['time']) if last else None,baselinePrice=base['value'] if base else None,lastPrice=last['value'] if last else None,chart=[])
    if not complete:return result
    sample=[base]+selected
    result['priceReturn']=(last['value']/base['value']-1)*100
    result['chart']=[dict(time=p['time'],value=(p['value']/base['value']-1)*100) for p in sample]
    changes=[math.log(b['value']/a['value']) for a,b in zip(sample,sample[1:])]
    # Gap-filled returns would bias daily volatility; with missing sessions disclose it instead.
    gap_limit=1 if crypto else 4
    if len(changes)>=20 and all((b['time']-a['time'])/86400<=gap_limit for a,b in zip(sample,sample[1:])):
        result['volatility']=statistics.stdev(changes)*math.sqrt(365 if crypto else 252)*100
    return result

def asset_result(asset,start,end,indicators):
    result=dict(asset=asset,metrics={},sources=[],limitations=[],chart=[],baselineDate=None,lastDate=None)
    try:
        data=history(asset,start,end);metrics=price_metrics(data['points'],start,end,asset['type']=='Crypto')
        result.update(chart=metrics.pop('chart'),baselineDate=metrics.pop('baselineDate'),lastDate=metrics.pop('lastDate'),baselinePrice=metrics.pop('baselinePrice'),lastPrice=metrics.pop('lastPrice'),currency=data['currency'])
        result['metrics'].update(metrics);result['metrics']['volume']=data['volume'];result['volumeUnit']=data['volumeUnit']
        result['sources'].append(dict(id='H',title=data['source']+' historical observations',url=data['url'],publishedAt=data['dataAsOf'],fetchedAt=data['fetchedAt']))
        if metrics['priceReturn'] is None:result['limitations'].append('Full-window price coverage or a preceding closing observation is missing; a window return is unavailable.')
        if metrics['volatility'] is None:result['limitations'].append('Daily annualized volatility unavailable: insufficient or discontinuous observations.')
    except DataUnavailable as exc:result['limitations'].append(str(exc))
    if asset['type']=='Stocks' and indicators & {'business','valuation','dividend'}:
        try:
            f=company_fundamentals(asset);m=f['metrics'];result['fundamentalsAsOf']=f['asOf']
            result['metrics'].update(revenueGrowth=m.get('QuarterlyRevenueGrowthYOY',None),earningsGrowth=m.get('QuarterlyEarningsGrowthYOY',None),pe=m.get('PERatio'),dividendYield=m.get('DividendYield'))
            result['sources'].append(dict(id='F',title='Alpha Vantage latest reported company overview',url=f['sourceUrl'],publishedAt=f['asOf'],fetchedAt=datetime.now(timezone.utc).isoformat()))
            result['limitations'].append('Revenue/earnings growth is latest reported quarterly year-over-year business growth, not price growth or necessarily the selected calendar quarter. Valuation/yield are current provider snapshots, not historical window-end metrics.')
        except DataUnavailable as exc:result['limitations'].append(str(exc))
    elif asset['type']!='Stocks':
        result['limitations'].append('Company revenue, earnings growth and P/E do not apply to this asset. Fund distribution yield is unavailable without a fund-specific provider.' if asset['type']=='ETFs' else 'Company revenue, earnings, P/E and dividend yield do not apply to this asset type.')
    if asset['type']=='Commodities':result['limitations'].append('Continuous futures prices may contain contract-roll effects; they are not spot commodity or realizable strategy returns.')
    return result

def default_benchmark(asset):
    if asset['type']=='Crypto':return 'crypto:bitcoin'
    if asset['type'] in ('Stocks','ETFs','Indexes'):
        country=BENCHMARKS.get(asset.get('country'))
        if country:return country
        if asset.get('exchange') in ('NASDAQ','NasdaqGS','NasdaqGM','NasdaqCM','NYSE','NYSE American','NYSE Arca'):return '^GSPC'
        if asset['id'].endswith(('.NS','.BO')):return '^NSEI'
    return None

def text(value,name,limit):
    if not isinstance(value,str) or len(value)>limit:raise AppError('Invalid '+name+'.')
    return value.strip()

def build(body):
    template=body.get('template','freeform');period=requested_period(body);start,end=window_dates(period)
    prompt=text(body.get('prompt',''),'prompt',2000)
    turns=body.get('history',[])
    if not isinstance(turns,list) or len(turns)>8:raise AppError('Conversation is too long; start a new analysis.')
    turns=[{'question':text(t.get('question',''),'question',2000),'takeaway':text(t.get('takeaway',''),'takeaway',6000)} for t in turns if isinstance(t,dict)]
    indicators=body.get('indicators',sorted(INDICATORS))
    if not isinstance(indicators,list) or any(not isinstance(v,str) or v not in INDICATORS for v in indicators):raise AppError('Choose supported indicators.')
    indicators=set(indicators)|{'price'}
    ids=body.get('assets',[])
    if not isinstance(ids,list) or len(ids)>2 or any(not isinstance(v,str) for v in ids):raise AppError('Select up to two assets.')
    # Catalog mentions in natural language supersede selectors; unknown assets still use explicit provider search selectors.
    mentions=[]
    for asset in ASSETS:
        matches=[re.search(r'(?<![\w])'+re.escape(value)+r'(?![\w])',prompt,re.I) for value in (asset['symbol'],asset['name']) if len(value)>=2]
        matches=[match for match in matches if match]
        if matches:mentions.append((min(match.start() for match in matches),asset['id']))
    for pattern,identifier in [(r'\b(?:bitcoin|BTC)\b','crypto:bitcoin'),(r'\b(?:ethereum|ETH)\b','crypto:ethereum')]:
        match=re.search(pattern,prompt,re.I)
        if match:mentions.append((match.start(),identifier))
    mentioned=list(dict.fromkeys(identifier for _,identifier in sorted(mentions)))
    if prompt and mentioned:ids=list(dict.fromkeys(mentioned))[:2]
    portfolio=template in ('concentration','portfolio-benchmark') or (template=='freeform' and (body.get('scope')=='portfolio' or bool(re.search(r'\b(portfolio|holdings|diversif|concentration)\w*\b',prompt,re.I))))
    if template=='freeform' and not prompt:raise AppError('Enter a research question.')
    if not portfolio and (not ids or (template=='compare' and len(set(ids))!=2)):raise AppError('Select two different assets for comparison.' if template=='compare' else 'Select an asset to research.')
    benchmark=body.get('benchmark') or (mentioned[-1] if (portfolio or len(mentioned)>2) and mentioned else None)
    if benchmark and (not isinstance(benchmark,str) or len(benchmark)>80):raise AppError('Choose a valid benchmark.')
    evidence=[];limitations=['Price returns exclude dividends, fees and currency conversion. Daily samples use UTC dates. No live feed is implied.'];portfolio_data=None
    if portfolio:
        context=portfolio_context(body);evidence=context['evidence'];limitations+=context['dataLimitations']
        positions=next(e['data'] for e in evidence if e['id']=='P1');portfolio_data=next(e['data'] for e in evidence if e['id']=='P2')
        portfolio_data['positions']=positions
        by_asset={}
        for position in positions:
            if finite(position.get('value')):by_asset[position['id']]=by_asset.get(position['id'],0)+position['value']
        portfolio_data['assetValues']=by_asset
        portfolio_data['largestAssetWeight']=max(by_asset.values())/portfolio_data['value']*100 if by_asset and portfolio_data['value']>0 else None
        ids=list(dict.fromkeys(p['id'] for p in positions if not p['id'].startswith('cash:')))
        if len(ids)>12:raise AppError('Research history supports up to 12 distinct portfolio assets. Select a smaller portfolio.')
        assets=[p['asset'] for p in positions if p['id'] in ids];assets=list({a['id']:a for a in assets}.values())
    else:assets=[resolve_asset(i) for i in list(dict.fromkeys(ids))]
    with ThreadPoolExecutor(max_workers=6) as pool:results=list(pool.map(lambda a:asset_result(a,start,end,indicators),assets))
    if len(results)>1 and len({(r['baselineDate'],r['lastDate']) for r in results})>1:
        limitations.append('Assets have different observed baseline or end dates; their price returns are not directly aligned. Read the exact dates before comparing.')
    benchmark_ids=list(dict.fromkeys(([benchmark] if benchmark else [default_benchmark(a) for a in assets]) if 'benchmark' in indicators else []));benchmark_ids=[i for i in benchmark_ids if i]
    benchmarks=[]
    for identifier in benchmark_ids:
        try:benchmarks.append(asset_result(resolve_asset(identifier),start,end,{'price'}))
        except (AppError,DataUnavailable) as exc:limitations.append('Benchmark '+identifier+': '+str(exc))
    for i,r in enumerate(results):
        b=next((b for b in benchmarks if b['asset']['id']==(benchmark or default_benchmark(r['asset']))),None)
        r['benchmark']=b['asset']['symbol'] if b else None;r['metrics']['benchmarkExcess']=None
        if b and r.get('currency')==b.get('currency') and r['baselineDate']==b['baselineDate'] and r['lastDate']==b['lastDate'] and finite(r['metrics'].get('priceReturn')) and finite(b['metrics'].get('priceReturn')):
            r['metrics']['benchmarkExcess']=r['metrics']['priceReturn']-b['metrics']['priceReturn']
        elif 'benchmark' in indicators:r['limitations'].append('Benchmark excess unavailable: no relevant benchmark or matching observation dates and quote currency. Select a suitable reference explicitly.')
        for s in r['sources']:s['id']=f'A{i+1}'+s['id']
        evidence.append(evidence_item(f'A{i+1}',r['asset']['symbol']+' historical facts and calculated metrics',{k:v for k,v in r.items() if k!='chart'},r['sources'][0]['url'] if r['sources'] else None,r['lastDate']))
        limitations+=r['limitations']
    for i,b in enumerate(benchmarks):
        for s in b['sources']:s['id']=f'B{i+1}'+s['id']
        evidence.append(evidence_item(f'B{i+1}',b['asset']['symbol']+' benchmark calculations',{k:v for k,v in b.items() if k!='chart'},b['sources'][0]['url'] if b['sources'] else None,b['lastDate']))
    if portfolio_data:
        portfolio_data['basketReturn']=None;portfolio_data['benchmarkExcess']=None;portfolio_data['basketChart']=[]
        # A fixed current-quantity basket is explicitly hypothetical, never historical account performance.
        valid=results and all(r['chart'] for r in results) and len({(r['baselineDate'],r['lastDate']) for r in results})==1
        if valid and all((r.get('currency')==body.get('currency','USD')) for r in results):
            lookup={r['asset']['id']:r for r in results};initial=final=0
            for p in portfolio_data['positions']:
                if p['id'].startswith('cash:'):
                    if p['currency']!=body.get('currency','USD'):valid=False;break
                    initial+=p['quantity'];final+=p['quantity'];continue
                r=lookup[p['id']]
                # recover baseline from ending current-window historical value via source-derived normalized curve
                # The raw baseline is supplied separately below for arithmetic, not inferred from a current quote.
                initial+=r['baselinePrice']*p['quantity'];final+=r['lastPrice']*p['quantity']
            if valid and initial>0:
                portfolio_data['basketReturn']=(final/initial-1)*100
                common=set.intersection(*[{point['time'] for point in r['chart']} for r in results])
                for time in sorted(common):
                    basket=0
                    for p in portfolio_data['positions']:
                        if p['id'].startswith('cash:'):basket+=p['quantity']
                        else:
                            basket_asset=lookup[p['id']];point=next(point for point in basket_asset['chart'] if point['time']==time)
                            basket+=basket_asset['baselinePrice']*(1+point['value']/100)*p['quantity']
                    portfolio_data['basketChart'].append(dict(time=time,value=(basket/initial-1)*100))
            b=benchmarks[0] if benchmarks else None
            if b and b.get('currency')==body.get('currency','USD') and results[0]['baselineDate']==b['baselineDate'] and results[0]['lastDate']==b['lastDate'] and finite(b['metrics'].get('priceReturn')) and finite(portfolio_data['basketReturn']):portfolio_data['benchmarkExcess']=portfolio_data['basketReturn']-b['metrics']['priceReturn']
        limitations.append('Portfolio benchmark comparison uses a hypothetical fixed basket of current quantities, not actual portfolio performance. It excludes cash flows, sold positions, dividends and historical rebalancing. Foreign-currency or incomplete histories make this basket unavailable.')
        evidence.append(evidence_item('PB','Hypothetical portfolio basket comparison',{k:v for k,v in portfolio_data.items() if k not in ('positions','basketChart')}))
    if template not in FREE or prompt:
        limitations.append('News coverage is recent headlines only and may lie outside the comparison window. Post-window headlines cannot establish causes of historical price moves.')
        for i,a in enumerate(assets[:2]):
            try:
                for n in news_evidence(asset_news(a['name'],a['symbol'])):n['id']=f'NEWS{i+1}'+n['id'];evidence.append(n)
            except DataUnavailable as exc:limitations.append(str(exc))
    available=[r for r in results if finite(r['metrics'].get('priceReturn'))]
    takeaway='No full-window price comparison is available. Review the source coverage and limitations below.'
    if len(available)==2:
        a,b=available;takeaway=f"{a['asset']['symbol']} price return: {a['metrics']['priceReturn']:.2f}%; {b['asset']['symbol']} price return: {b['metrics']['priceReturn']:.2f}%. Business growth is shown separately when reported."
    elif available:takeaway=f"{available[0]['asset']['symbol']} price return: {available[0]['metrics']['priceReturn']:.2f}% over its displayed observation dates."
    return dict(template=template,timeframe=period,window=dict(start=start.isoformat(),end=end.isoformat(),label='Last completed calendar quarter' if period=='quarter' else 'Completed UTC days'),assets=results,benchmarks=benchmarks,portfolio=portfolio_data,takeaway=takeaway,indicators=sorted(indicators),limitations=list(dict.fromkeys(limitations)),sources=[s for r in results+benchmarks for s in r['sources']],generatedAt=datetime.now(timezone.utc).isoformat(),context=dict(kind='research',request=prompt,conversation=turns,evidence=evidence,dataLimitations=list(dict.fromkeys(limitations)),window=dict(start=start.isoformat(),end=end.isoformat())))

def run(body,free,additional_evidence=None):
    result=build(body);context=result.pop('context');result['interpretation']=None
    if additional_evidence:
        for evidence in additional_evidence:
            context['evidence'].append(evidence)
    if not free:result['interpretation']=generate_report(context)
    return result

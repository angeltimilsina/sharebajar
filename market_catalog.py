"""Mock market adapter. Replace assets_for() with live adapters when licensed feeds exist."""
import json
from pathlib import Path
MARKETS=json.loads((Path(__file__).parent/'market-config.json').read_text(encoding='utf-8'))
BY_CODE={m['marketCode']:m for m in MARKETS}
TYPES=['stocks','crypto','etfs','indexes','gainers','losers','trending','most-watched']
SECTORS=['technology','financials','energy','consumer','healthcare']
STOCKS={
'us':[('AAPL','Apple','technology'),('MSFT','Microsoft','technology'),('JPM','JPMorgan Chase','financials'),('XOM','Exxon Mobil','energy'),('NVDA','NVIDIA','technology'),('JNJ','Johnson & Johnson','healthcare'),('KO','Coca-Cola','consumer')],
'nepal':[('NABIL','Nabil Bank','financials'),('NICA','NIC Asia Bank','financials'),('HDL','Himalayan Distillery','consumer'),('NTC','Nepal Telecom','technology')],
'india':[('RELIANCE','Reliance Industries','energy'),('TCS','Tata Consultancy Services','technology'),('HDFCBANK','HDFC Bank','financials'),('INFY','Infosys','technology')],
'uk':[('SHEL','Shell','energy'),('HSBA','HSBC','financials'),('AZN','AstraZeneca','healthcare'),('ULVR','Unilever','consumer')],
'canada':[('RY','Royal Bank of Canada','financials'),('SHOP','Shopify','technology'),('ENB','Enbridge','energy')],
'australia':[('CBA','Commonwealth Bank','financials'),('BHP','BHP Group','energy'),('CSL','CSL','healthcare')],
'japan':[('7203','Toyota Motor','consumer'),('6758','Sony Group','technology'),('8306','Mitsubishi UFJ','financials')],
'south-korea':[('005930','Samsung Electronics','technology'),('000660','SK Hynix','technology'),('005380','Hyundai Motor','consumer')],
'singapore':[('D05','DBS Group','financials'),('O39','OCBC','financials'),('U11','UOB','financials')],
'uae':[('EMAAR','Emaar Properties','consumer'),('DIB','Dubai Islamic Bank','financials'),('ADNOCGAS','ADNOC Gas','energy')],
'saudi-arabia':[('2222','Saudi Aramco','energy'),('1120','Al Rajhi Bank','financials'),('7010','stc','technology')],
'germany':[('SAP','SAP','technology'),('SIE','Siemens','technology'),('ALV','Allianz','financials')],
'france':[('MC','LVMH','consumer'),('TTE','TotalEnergies','energy'),('SAN','Sanofi','healthcare')],
'netherlands':[('ASML','ASML Holding','technology'),('INGA','ING Group','financials'),('HEIA','Heineken','consumer')],
'switzerland':[('NESN','Nestlé','consumer'),('NOVN','Novartis','healthcare'),('UBSG','UBS Group','financials')],
'hong-kong':[('0700','Tencent','technology'),('9988','Alibaba','consumer'),('1299','AIA Group','financials')],
'china':[('600519','Kweichow Moutai','consumer'),('601398','ICBC','financials'),('300750','CATL','technology')]}

def assets_for(code):
    market=BY_CODE[code]
    if code=='crypto':
        base=[('BTC','Bitcoin','crypto','digital-assets'),('ETH','Ethereum','crypto','digital-assets'),('SOL','Solana','crypto','digital-assets'),('BNB','BNB','crypto','digital-assets')]
    else:
        base=[(s,n,'stocks',sector) for s,n,sector in STOCKS[code]]
        # Intentionally illustrative fund identifiers, not claims of listed local ETFs.
        base += [('DEMO-ETF',market['countryName']+' Broad Market ETF (demo)','etfs','diversified'),('DEMO-INDEX',market['topIndexName'],'indexes','diversified')]
    result=[]
    for i,(symbol,name,kind,sector) in enumerate(base):
        seed=sum(ord(c) for c in code+symbol)
        price=round((seed%900+50)*(10 if market['currency'] in ['NPR','JPY','KRW','INR'] else 1),2)
        changes={'1d':[2.35,-1.42,4.18,-2.76,.64,1.12][i%6],'7d':[4.1,-3.7,8.4,-6.2,1.8,2.9][i%6],'1mo':[8.6,-7.3,12.8,-5.4,3.2,4.6][i%6],'1y':[18.2,-12.1,25.4,-8.2,7.1,9.4][i%6]}
        result.append(dict(symbol=symbol,name=name,assetType=kind,sector=sector,marketCode=code,currency=market['currency'],exchange=market['exchangeNames'][i%len(market['exchangeNames'])],price=price,changes=changes,marketCap=(seed%90+10)*1000000000,volume=(seed%60+5)*1000000,trendingScore=100-i*9,watchCount=1000-i*120,history=[round(price*(.95+j*.006+((seed+j)%3)*.008),2) for j in range(12)],isMock=True))
    return result

def all_assets():return [a for m in MARKETS for a in assets_for(m['marketCode'])]

def ranked_assets(code=None,view='',sector='',asset_type='',period='1d'):
    assets=assets_for('crypto' if view=='crypto' else code) if code else all_assets()
    if view in ['stocks','etfs','indexes','crypto']:assets=[a for a in assets if a['assetType']==view]
    if asset_type:assets=[a for a in assets if a['assetType']==asset_type]
    if sector:assets=[a for a in assets if a['sector']==sector]
    if view=='gainers':assets=[a for a in assets if a['changes'][period]>0]
    if view=='losers':assets=[a for a in assets if a['changes'][period]<0]
    key=(lambda a:a['changes'][period]) if view in ['gainers','losers'] else (lambda a:a['trendingScore']) if view=='trending' else (lambda a:a['watchCount']) if view=='most-watched' else (lambda a:a['marketCap'])
    return sorted(assets,key=key,reverse=view!='losers')

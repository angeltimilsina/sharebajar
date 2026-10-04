import argparse, json, os
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from catalog import ASSETS, REGIONS
from providers import YahooProvider, CoinGeckoProvider, DataUnavailable, request_json
ROOT=Path(__file__).parent
stock=YahooProvider(); crypto=CoinGeckoProvider()
POOL=ThreadPoolExecutor(max_workers=6)
def one_quote(symbol,period='1d'):
    try:
        result=dict(id=symbol,**(crypto.quote(symbol[7:],{'1h':1,'7d':7,'1d':1,'5d':7,'1mo':30,'3mo':90,'1y':365,'5y':1825,'max':'max'}[period]) if symbol.startswith('crypto:') else stock.quote(symbol,period)))
        if period=='1h' and symbol.startswith('crypto:') and result.get('history'):
            end=result['history'][-1]['time']
            result['history']=[p for p in result['history'] if p['time']>=end-3600]
        return result
    except DataUnavailable as e: return dict(id=symbol,error=str(e))
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT/'static'),**kwargs)
    def send_json(self,data,status=200):
        body=json.dumps(data,allow_nan=False).encode(); self.send_response(status)
        self.send_header('Content-Type','application/json'); self.send_header('Cache-Control','no-store'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        parsed=urlsplit(self.path)
        if not parsed.path.startswith('/api/'): return super().do_GET()
        p=parse_qs(parsed.query); get=lambda k,default='':p.get(k,[default])[0]
        try:
            route=parsed.path[5:]
            if route=='health': return self.send_json({'status':'ok'})
            if route=='catalog': return self.send_json({'assets':ASSETS,'regions':REGIONS})
            if route=='quotes':
                symbols=get('symbols').split(','); period=get('range','1d')
                if len(symbols)>20 or not all(0<len(s)<=80 for s in symbols) or period not in ['1h','1d','5d','7d','1mo','3mo','1y','5y','max']: return self.send_json({'error':'Invalid quote request'},400)
                return self.send_json(list(POOL.map(lambda s:one_quote(s,period),symbols)))
            if route=='search':
                query=get('q').strip()[:100]
                if not query: return self.send_json({'assets':[]})
                local=[a for a in ASSETS if query.lower() in (a['name']+' '+a['symbol']+' '+a['country']).lower()]
                warnings=[]
                try: local+=stock.search(query)
                except DataUnavailable: warnings.append('Global security search is unavailable; showing catalog matches.')
                try: local += [dict(id='crypto:'+a['id'],name=a['name'],symbol=a['symbol'].upper(),type='Crypto',currency='USD',exchange='CoinGecko',country='Global',region='World') for a in crypto.search(query)]
                except DataUnavailable: warnings.append('Crypto search is temporarily unavailable.')
                return self.send_json({'assets':list({a['id']:a for a in local}.values()),'warnings':warnings})
            if route=='crypto/assets':
                page=max(1,min(100,int(get('page','1')))); items=crypto.get_assets(page)
                return self.send_json([dict(a,id='crypto:'+a['id'],providerId=a['id'],name=a['name'],symbol=a['symbol'].upper(),type='Crypto',region='World',country='Global',currency='USD',exchange='CoinGecko') for a in items])
            if route=='crypto/exchanges': return self.send_json(crypto.get_exchanges(max(1,min(100,int(get('page','1'))))))
            if route=='crypto/markets': return self.send_json(crypto.get_markets(get('id')[:80]))
            if route=='crypto/exchange': return self.send_json(crypto.get_exchange(get('id')[:80]))
            if route=='fx':
                base=get('base','USD')
                if len(base)!=3 or not base.isalpha(): return self.send_json({'error':'Invalid currency'},400)
                return self.send_json(request_json('https://api.frankfurter.dev/v1/latest?base='+base))
            self.send_json({'error':'Not found'},404)
        except DataUnavailable as e: self.send_json({'error':str(e)},503)
        except (ValueError,KeyError): self.send_json({'error':'Invalid request'},400)
        except Exception: self.send_json({'error':'Provider response could not be processed'},502)
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff'); super().end_headers()
if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=3000); parser.add_argument('--host',default='127.0.0.1'); args=parser.parse_args()
    print(f'ShareBajar running on {args.host}:{args.port}',flush=True)
    ThreadingHTTPServer((args.host,args.port),Handler).serve_forever()

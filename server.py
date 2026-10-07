from financial_pages import render as render_financial_page
from financial_engine import generate_page,generated_page_paths,list_templates,valuation_assets,market_valuation,MOBILE_SCREENS,PRICING
from financial_content import admin as content_admin,create_draft,list_drafts,publish as publish_draft
from growth_workspace import get_state as growth_state,mutate as growth_mutate,export_report as growth_export,render_workspace,VIEWS as GROWTH_VIEWS
from product_shell import render_shell,base_url
from market_pages import render as render_market_page, sitemap as market_sitemap
from market_catalog import MARKETS as PUBLIC_MARKETS, BY_CODE as PUBLIC_MARKET_CODES, TYPES as PUBLIC_MARKET_TYPES, SECTORS as PUBLIC_MARKET_SECTORS, ranked_assets as public_ranked_assets
from public_ai import analyze as public_asset_analysis, usage as public_ai_usage
import argparse, html, json, os, secrets, time
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from catalog import ASSETS, REGIONS
from providers import YahooProvider, CoinGeckoProvider, DataUnavailable, request_json
from news import market_news, asset_news, today_news, category_news, NEWS_CATEGORIES, MARKETS, safe_link
from news_brief import news_brief
from membership import AppError, authenticated_user, account_details, signup, login, logout, require_plan, reserve_usage, effective_plan, request_password_reset, reset_password, google_authorization_url, google_login, list_users, manage_user
from ai_analysis import asset_context, portfolio_context, planning_context, generate_report, resolve_asset
from threading import BoundedSemaphore
from research import authorize as authorize_research, run as run_research
from research_history import list_conversations,get_conversation,save_exchange,delete_conversation,history_for_model
from technical_analysis import build_technicals,ai_evidence
ROOT=Path(__file__).parent
stock=YahooProvider(); crypto=CoinGeckoProvider()
POOL=ThreadPoolExecutor(max_workers=6)
AI_WORKERS=BoundedSemaphore(3)
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
    def send_google_completion(self,token):
        nonce=secrets.token_urlsafe(18)
        script=f"sessionStorage.setItem('sharebajar-session',{json.dumps(token)});location.replace('/#overview');"
        body=('<!doctype html><html lang="en"><meta charset="utf-8"><title>Signed in</title>'
              f'<script nonce="{nonce}">{script}</script><p>Google sign-in complete. Return to ShareBajar.</p></html>').encode()
        self.send_response(200)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',f"default-src 'none'; script-src 'nonce-{nonce}'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header('Set-Cookie','sharebajar-oauth-state=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0'+('; Secure' if os.environ.get('SHAREBAJAR_PUBLIC_URL','').startswith('https://') else ''))
        self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def send_oauth_error(self,error):
        body=('<!doctype html><html lang="en"><meta charset="utf-8"><title>Sign-in failed</title>'
              f'<p>{html.escape(str(error))}</p><a href="/">Return to ShareBajar</a></html>').encode()
        self.send_response(error.status if isinstance(error,AppError) else 502)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header('Set-Cookie','sharebajar-oauth-state=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0'+('; Secure' if os.environ.get('SHAREBAJAR_PUBLIC_URL','').startswith('https://') else ''))
        self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def send_public_page(self,body,content_type='text/html; charset=utf-8',status=200):
        raw=body.encode('utf-8');self.send_response(status)
        self.send_header('Content-Type',content_type);self.send_header('Cache-Control','no-cache')
        self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        parsed=urlsplit(self.path)
        if parsed.path=='/sitemap.xml':return self.send_public_page(market_sitemap(),'application/xml; charset=utf-8')
        if parsed.path=='/robots.txt':
            base=os.environ.get('SHAREBAJAR_PUBLIC_URL','http://localhost:3000').rstrip('/')
            return self.send_public_page('User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /workspace\nDisallow: /internal/\nSitemap: '+base+'/sitemap.xml\n','text/plain; charset=utf-8')
        if parsed.path=='/markets' or parsed.path.startswith('/markets/') or parsed.path.startswith('/asset/'):
            page=render_market_page(parsed.path,parsed.query)
            if page is None:return self.send_public_page('<!doctype html><title>Market page not found</title><h1>Market page not found</h1><a href="/markets">Explore supported markets</a>',status=404)
            return self.send_public_page(page)
        if parsed.path=='/workspace' or parsed.path.startswith('/workspace/'):
            view=parsed.path.rsplit('/',1)[-1] if parsed.path!='/workspace' else 'overview'
            if view=='risk':view='portfolio'
            if view not in GROWTH_VIEWS:return self.send_public_page('<h1>Workspace page not found</h1>',status=404)
            return self.send_public_page(render_shell(render_workspace(view=view),'Your Research Workspace | Sharebajar','Private portfolio, watchlist and financial research workspace.',parsed.path,private=True))
        if not parsed.path.startswith('/api/'):
            query=parsed.query
            if parsed.path in ('/','/index.html') and 'market' not in parse_qs(query):
                cookie=SimpleCookie()
                try:cookie.load(self.headers.get('Cookie',''))
                except Exception:pass
                selected=cookie.get('sharebajar-market')
                if selected and selected.value in PUBLIC_MARKET_CODES:query=('market='+selected.value)+('&'+query if query else '')
            page=render_financial_page(parsed.path,query)
            if page is not None:return self.send_public_page(page)
            if parsed.path.startswith(('/research/','/trends/','/compare/','/learn/','/campaigns/','/internal/','/app/')):return self.send_public_page('<h1>Research page not found</h1><a href="/research">Explore research</a>',status=404)
            return super().do_GET()
        p=parse_qs(parsed.query); get=lambda k,default='':p.get(k,[default])[0]
        try:
            route=parsed.path[5:]
            if route=='auth/google/start':
                reserve_usage('google-oauth:'+self.client_address[0],20,3600)
                state=secrets.token_urlsafe(32)
                redirect=google_authorization_url(state)
                secure=os.environ.get('SHAREBAJAR_PUBLIC_URL','').startswith('https://')
                self.send_response(302);self.send_header('Location',redirect)
                self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer')
                self.send_header('Set-Cookie','sharebajar-oauth-state='+state+'; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=600'+('; Secure' if secure else ''))
                self.send_header('Content-Length','0');self.end_headers();return
            if route=='auth/google/callback':
                cookie=SimpleCookie()
                cookie.load(self.headers.get('Cookie',''))
                state_cookie=cookie.get('sharebajar-oauth-state')
                if get('error'):raise AppError('Google sign-in was cancelled. Please try again.',400,'google_cancelled')
                result=google_login(get('code'),get('state'),state_cookie.value if state_cookie else '')
                return self.send_google_completion(result['token'])
            if route=='financial/templates':return self.send_json({'templates':list_templates(),'pricing':PRICING,'dataMode':'mock'})
            if route=='financial/valuation':
                code=get('market','us')
                rows=valuation_assets(code,view=get('view'),asset_type=get('type'),sector=get('sector'),period=get('range','1d'),valuation=get('valuation','all'),sort=get('sort','valuation'))
                return self.send_json({'market':PUBLIC_MARKET_CODES[code],'overview':market_valuation(code),'assets':rows,'isMock':True})
            if route=='financial/page':
                payload=generated_page_paths().get(get('path'))
                if payload is None:raise AppError('Research page not found.',404,'not_found')
                page=generate_page(payload,base_url())
                if page['visibility']!='public':raise AppError('Private research is available in your workspace.',403,'private_page')
                return self.send_json(page)
            if route=='financial/screens':
                code=get('market','us')
                return self.send_json({'screens':[dict(generate_page({'template':'app-screen','marketCode':code,'screen':s['id']},base_url())['appScreen'],name=s['name']) for s in MOBILE_SCREENS],'dataMode':'mock','previewOnly':True})
            if route=='financial/drafts':return self.send_json({'drafts':list_drafts(authenticated_user(self.headers.get('Authorization')))})
            if route=='growth/state':return self.send_json(growth_state(authenticated_user(self.headers.get('Authorization'))))
            if route=='growth/export':return self.send_json(growth_export(authenticated_user(self.headers.get('Authorization')),get('id')))
            if route=='markets/config':return self.send_json(PUBLIC_MARKETS)
            if route=='markets/rankings':
                code=get('market');view=get('view');sector=get('sector');kind=get('type');period=get('range','1d')
                if code not in ['',*PUBLIC_MARKET_CODES] or view not in ['',*PUBLIC_MARKET_TYPES] or sector not in ['',*PUBLIC_MARKET_SECTORS,'digital-assets','diversified'] or kind not in ['','stocks','crypto','etfs','indexes'] or period not in ['1d','7d','1mo','1y']:raise AppError('Choose valid market filters.')
                return self.send_json({'source':'mock','isMock':True,'market':code or 'global','range':period,'assets':public_ranked_assets(code or None,view,sector,kind,period)})
            if route=='ai/public/usage': return self.send_json(public_ai_usage(self.client_address[0]))
            if route=='health': return self.send_json({'status':'ok'})
            if route=='account':
                account=account_details(authenticated_user(self.headers.get('Authorization')))
                account['upgrades']={plan:safe_link(os.environ.get('SHAREBAJAR_'+plan.upper()+'_CHECKOUT_URL')) for plan in ['plus','pro']}
                return self.send_json(account)
            if route=='admin/users':
                return self.send_json(list_users(authenticated_user(self.headers.get('Authorization')),get('q'),get('limit','100'),get('offset','0')))
            if route=='research/conversations':
                user=authenticated_user(self.headers.get('Authorization'));require_plan(user,'pro')
                return self.send_json(list_conversations(user['id'],get('limit','50'),get('offset','0')))
            if route.startswith('research/conversations/'):
                user=authenticated_user(self.headers.get('Authorization'));require_plan(user,'pro')
                conversation_id=route.rsplit('/',1)[-1]
                if not conversation_id or len(conversation_id)>64:raise AppError('Conversation not found.',404,'conversation_not_found')
                return self.send_json(get_conversation(user['id'],conversation_id))
            if route=='candles':
                asset_id=get('asset')
                if not asset_id or len(asset_id)>80:raise AppError('Choose a valid asset.')
                return self.send_json(build_technicals(asset_id,get('range','3mo'),include_indicators=False))
            if route=='research/technicals':
                user=authenticated_user(self.headers.get('Authorization'));require_plan(user,'pro')
                asset_id=get('asset')
                if not asset_id or len(asset_id)>80:raise AppError('Choose a valid asset.')
                return self.send_json(build_technicals(asset_id,get('range','3mo'),get('horizon','1mo')))
            if route=='catalog': return self.send_json({'assets':list(ASSETS),'regions':REGIONS})
            if route=='news/brief':
                reserve_usage('news-brief:'+self.client_address[0],60,3600)
                return self.send_json(news_brief(get('market','United States'),get('asset')))
            if route=='news/today':
                reserve_usage('news-today:'+self.client_address[0],60,3600)
                return self.send_json(today_news(get('market','United States'),get('start'),get('end')))
            if route=='news/categories':
                return self.send_json({'categories':[{'id':key,'title':value[0]} for key,value in NEWS_CATEGORIES.items()],'markets':['Global',*MARKETS]})
            if route=='news/feed':
                reserve_usage('news-feed:'+self.client_address[0],120,3600)
                return self.send_json(category_news(get('category','all'),get('market','Global')))
            if route=='news':
                reserve_usage('news:'+self.client_address[0],120,3600)
                if get('asset'):
                    asset=resolve_asset(get('asset'))
                    return self.send_json(asset_news(asset['name'],asset['symbol']))
                return self.send_json(market_news(get('market','United States')))
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
                try: local += [] if get('type')=='Stocks' else [dict(id='crypto:'+a['id'],name=a['name'],symbol=a['symbol'].upper(),type='Crypto',currency='USD',exchange='CoinGecko',country='Global',region='World') for a in crypto.search(query)]
                except DataUnavailable: warnings.append('Crypto search is temporarily unavailable.')
                if get('type')=='Stocks': local=[a for a in local if a['type']=='Stocks']
                return self.send_json({'assets':list({a['id']:a for a in local}.values()),'warnings':warnings})
            if route=='crypto/global': return self.send_json(crypto.get('/global'))
            if route=='crypto/assets':
                page=max(1,min(100,int(get('page','1')))); items=crypto.get_assets(page)
                return self.send_json([dict(a,id='crypto:'+a['id'],providerId=a['id'],name=a['name'],symbol=a['symbol'].upper(),type='Crypto',region='World',country='Global',currency='USD',exchange='CoinGecko') for a in items])
            if route=='crypto/exchanges': return self.send_json(crypto.get_exchanges(max(1,min(100,int(get('page','1'))))))
            if route=='crypto/markets':
                coin_id=get('id')
                if not coin_id or len(coin_id)>80:raise AppError('Choose a valid crypto asset.')
                return self.send_json(crypto.get_markets(coin_id))
            if route=='crypto/exchange':
                exchange_id=get('id')
                if not exchange_id or len(exchange_id)>80:raise AppError('Choose a valid exchange.')
                return self.send_json(crypto.get_exchange(exchange_id))
            if route=='fx':
                base=get('base','USD')
                if len(base)!=3 or not base.isalpha(): return self.send_json({'error':'Invalid currency'},400)
                return self.send_json(request_json('https://api.frankfurter.dev/v1/latest?base='+base))
            self.send_json({'error':'Not found'},404)
        except AppError as e:
            if urlsplit(self.path).path=='/api/auth/google/callback':return self.send_oauth_error(e)
            self.send_json({'error':str(e),'code':e.code,'requiredPlan':e.required_plan},e.status)
        except DataUnavailable as e: self.send_json({'error':str(e)},503)
        except (ValueError,KeyError): self.send_json({'error':'Invalid request'},400)
        except Exception: self.send_json({'error':'Provider response could not be processed'},502)
    def do_POST(self):
        route=urlsplit(self.path).path
        allowed={'/api/financial/generate','/api/financial/publish','/api/growth/action','/api/ai/public/asset','/api/auth/signup','/api/auth/login','/api/auth/logout','/api/auth/password-reset-request','/api/auth/password-reset','/api/admin/users/manage','/api/ai/portfolio','/api/ai/plan','/api/ai/asset','/api/research','/api/research/chat'}
        if route not in allowed:return self.send_json({'error':'Not found'},404)
        try:
            if self.headers.get('Content-Type','').split(';')[0].strip()!='application/json':raise AppError('Send a JSON request.',415)
            if self.headers.get('Transfer-Encoding'):raise AppError('Unsupported request encoding.',400)
            length=int(self.headers.get('Content-Length','0'))
            if not 1<=length<=65536:raise AppError('Request is too large or empty.',413)
            self.connection.settimeout(15)
            raw=self.rfile.read(length)
            if len(raw)!=length:raise AppError('Incomplete request.')
            def reject_constant(value):raise ValueError('Non-finite number')
            body=json.loads(raw,parse_constant=reject_constant)
            if not isinstance(body,dict):raise AppError('Invalid request.')
            if route=='/api/ai/public/asset':
                reserve_usage('public-ai-attempt:'+self.client_address[0],30,3600)
                if not AI_WORKERS.acquire(blocking=False):raise AppError('Analysis is busy. Retry shortly.',429,'busy')
                try:return self.send_json(public_asset_analysis(body,self.client_address[0]))
                finally:AI_WORKERS.release()
            authorization=self.headers.get('Authorization')
            if route in ['/api/auth/signup','/api/auth/login']:
                reserve_usage('auth:'+self.client_address[0],30,3600)
                return self.send_json(signup(body) if route.endswith('signup') else login(body))
            if route=='/api/auth/logout':logout(authorization);return self.send_json({'signedOut':True})
            if route=='/api/auth/password-reset-request':
                reserve_usage('password-reset:'+self.client_address[0],5,3600)
                return self.send_json(request_password_reset(body.get('email')))
            if route=='/api/auth/password-reset':
                reserve_usage('password-reset-finish:'+self.client_address[0],10,3600)
                return self.send_json(reset_password(body))
            if route=='/api/admin/users/manage':
                reserve_usage('admin:'+self.client_address[0],120,3600)
                return self.send_json(manage_user(authenticated_user(authorization),body))
            user=authenticated_user(authorization)
            if not user:raise AppError('Sign in to access research.',401,'unauthorized')
            if route=='/api/growth/action':
                reserve_usage('growth:'+user['id'],120,3600)
                return self.send_json(growth_mutate(user,body))
            if route=='/api/financial/generate':
                content_admin(user);reserve_usage('financial-generation:'+user['id'],60,3600)
                return self.send_json(create_draft(user,generate_page(body,base_url())))
            if route=='/api/financial/publish':return self.send_json(publish_draft(user,body.get('id')))
            if route=='/api/research':
                # Verify advanced access before touching providers or the model.
                free=authorize_research(body,user,self.client_address[0])
                if not free and not os.environ.get('OPENAI_API_KEY'):raise AppError('AI analysis is not configured on this server yet.',503,'ai_not_configured')
                if not AI_WORKERS.acquire(blocking=False):raise AppError('Analysis is busy. Retry shortly.',429,'busy')
                try:return self.send_json(run_research(body,free))
                finally:AI_WORKERS.release()
            if route=='/api/research/chat':
                require_plan(user,'pro')
                prompt=body.get('prompt')
                asset_id=body.get('assetId')
                if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>2000:raise AppError('Enter a research question up to 2,000 characters.')
                if not isinstance(asset_id,str) or not asset_id or len(asset_id)>80:raise AppError('Choose an asset to research.')
                conversation_id=body.get('conversationId')
                if conversation_id is not None and (not isinstance(conversation_id,str) or not 1<=len(conversation_id)<=64):raise AppError('Choose a valid conversation.')
                chart_range=body.get('chartRange','3mo');horizon=body.get('horizon','1mo')
                if not os.environ.get('OPENAI_API_KEY'):raise AppError('AI analysis is not configured on this server yet.',503,'ai_not_configured')
                reserve_usage('ai:'+user['id'],40)
                technical=build_technicals(asset_id,chart_range,horizon)
                context={'template':'freeform','prompt':prompt.strip(),'assets':[asset_id],'timeframe':'3mo','indicators':['price'],'history':history_for_model(user['id'],conversation_id)}
                if not AI_WORKERS.acquire(blocking=False):raise AppError('Analysis is busy. Retry shortly.',429,'busy')
                try:
                    result=run_research(context,False,[{
                        'id':'TECH1','title':technical['asset']['symbol']+' calculated OHLC indicators and historical scenario band',
                        'data':ai_evidence(technical),'url':technical['sourceUrl'],'publishedAt':time.strftime('%Y-%m-%d',time.gmtime(technical['candles'][-1]['time'])),
                    }])
                    saved=save_exchange(user['id'],conversation_id,prompt,result,{'assetId':asset_id,'chartRange':chart_range,'horizon':horizon})
                    return self.send_json(dict(**saved,result=result,technical=technical))
                finally:AI_WORKERS.release()
            required='plus'
            require_plan(user,required)
            if not os.environ.get('OPENAI_API_KEY'):raise AppError('AI analysis is not configured on this server yet.',503,'ai_not_configured')
            if not AI_WORKERS.acquire(blocking=False):raise AppError('AI analysis is busy. Retry shortly.',429,'busy')
            try:
                reserve_usage('ai:'+user['id'],40 if effective_plan(user)=='pro' else 10)
                context=asset_context(body) if route=='/api/ai/asset' else planning_context(body) if route=='/api/ai/plan' else portfolio_context(body)
                return self.send_json(generate_report(context))
            finally:AI_WORKERS.release()
        except AppError as e:self.send_json({'error':str(e),'code':e.code,'requiredPlan':e.required_plan},e.status)
        except (ValueError,TypeError,UnicodeDecodeError):self.send_json({'error':'Invalid request'},400)
        except DataUnavailable as e:self.send_json({'error':str(e)},503)
        except Exception:self.send_json({'error':'The analysis request could not be processed.'},502)
    def do_DELETE(self):
        route=urlsplit(self.path).path[5:] if urlsplit(self.path).path.startswith('/api/') else ''
        try:
            if not route.startswith('research/conversations/'):return self.send_json({'error':'Not found'},404)
            user=authenticated_user(self.headers.get('Authorization'));require_plan(user,'pro')
            conversation_id=route.rsplit('/',1)[-1]
            if not conversation_id or len(conversation_id)>64:raise AppError('Conversation not found.',404,'conversation_not_found')
            return self.send_json(delete_conversation(user['id'],conversation_id))
        except AppError as e:self.send_json({'error':str(e),'code':e.code,'requiredPlan':e.required_plan},e.status)
        except Exception:self.send_json({'error':'The conversation could not be deleted.'},500)
    def end_headers(self):
        origin=self.headers.get('Origin')
        allowed={'capacitor://localhost','http://localhost','https://localhost'}
        allowed.update(filter(None,os.environ.get('SHAREBAJAR_ALLOWED_ORIGINS','').split(',')))
        if origin in allowed:
            self.send_header('Access-Control-Allow-Origin',origin)
            self.send_header('Vary','Origin')
        path=urlsplit(self.path).path
        if not path.startswith('/api/') and (path in ('/','/index.html') or Path(path).suffix in ('.js','.mjs')):
            self.send_header('Cache-Control','no-cache')
        self.send_header('X-Content-Type-Options','nosniff'); super().end_headers()
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type, Authorization')
        self.send_header('Content-Length','0');self.end_headers()
if __name__=='__main__':
    from environment import load_environment
    load_environment()
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=3000); parser.add_argument('--host',default='127.0.0.1'); args=parser.parse_args()
    print(f'ShareBajar running on {args.host}:{args.port}',flush=True)
    ThreadingHTTPServer((args.host,args.port),Handler).serve_forever()

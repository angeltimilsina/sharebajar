"""Crawlable financial research pages consuming the shared page contract."""
import json
from urllib.parse import parse_qs
from product_shell import render_shell,base_url,esc
from financial_engine import generate_page,generated_page_paths,market_valuation,valuation_assets,PRICING,MOBILE_SCREENS,PAGE_TEMPLATES
from market_catalog import MARKETS,BY_CODE
from financial_content import get_published,published_paths

def card(title,description,url,tag='Research'):
    return '<a class="fin-card" href="'+esc(url)+'"><span class="eyebrow">'+esc(tag)+'</span><h3>'+esc(title)+'</h3><p>'+esc(description)+'</p><span class="fin-card-arrow">Explore →</span></a>'

def grid(items):return '<div class="fin-grid">'+''.join(items)+'</div>'
def heading(title,desc,eyebrow='SHAREBAJAR / FINANCIAL INTELLIGENCE'):
    return '<section class="fin-heading"><div class="eyebrow">'+esc(eyebrow)+'</div><h1>'+esc(title)+'</h1><p>'+esc(desc)+'</p></section>'
def notice():return '<p class="fin-notice"><strong>Mock research preview.</strong> Prices, valuation metrics and trend signals are illustrative. Generated pages use financial templates; live data and AI adapters can be connected later.</p>'
def metrics(page):
    return '<div class="fin-metrics">'+''.join('<a href="'+esc(c['url'])+'"><small>'+esc(c['label'])+'</small><strong>'+esc(c['value'] if c['value'] is not None else 'Not rated')+'</strong><span>'+esc(c['detail'])+'</span></a>' for c in page['marketCards'])+'</div>'
def research_body(page):
    from market_pages import table
    r=page['researchSummary'];rows=page['rankingTable']['rows'];period=page['rankingTable']['period'];cta=page['cta']
    body='<nav class="seo-breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><a href="/markets/'+page['marketCode']+'">'+esc(page['market']['countryName'])+'</a><span>'+esc(page['title'])+'</span></nav>'+heading(page['title'],page['hero']['description'],page['hero']['eyebrow'])+notice()+metrics(page)
    body+='<div class="fin-section-heading"><h2>Assets in this research screen</h2><a href="/markets/'+page['marketCode']+'/valuation">Change valuation filters →</a></div>'+table(rows,period)
    body+=grid([card(a['name']+' · '+a['symbol'],a['valuationLabel']+' · '+str(a['price'])+' '+a['currency'],a['assetUrl'],'ASSET RESEARCH') for a in page['assetCards']])
    body+='<section class="fin-research"><span class="eyebrow">STRUCTURED RESEARCH SUMMARY</span><h2>'+esc(r['headline'])+'</h2><p>'+esc(r['summary'])+'</p><div class="fin-grid">'+''.join('<article><h3>'+esc(d['label'])+'</h3><p>'+esc(d['detail'])+'</p><small>'+esc(d.get('source','Mock financial catalog'))+'</small></article>' for d in r['drivers'])+'</div><details><summary>Methodology and evidence</summary><p>'+esc(r['methodology'])+'</p>'+''.join('<a href="'+esc(e['url'])+'">'+esc(e['label'])+'</a> · ' for e in r['evidence'])+'<ul>'+''.join('<li>'+esc(x)+'</li>' for x in r['risks'])+'</ul></details></section>'
    body+='<div class="fin-grid">'+''.join('<article class="fin-article"><h2>'+esc(s['title'])+'</h2><p>'+esc(s['body'])+'</p></article>' for s in page['sections'])+'</div>'
    body+='<section class="fin-related"><h2>Continue your research</h2>'+''.join('<a href="'+esc(l['url'])+'">'+esc(l['label'])+' →</a>' for l in page['relatedLinks'])+'</section><section class="fin-cta"><div><h2>'+esc(cta['title'])+'</h2><p>'+esc(cta['description'])+'</p></div><a class="primary" href="'+esc(cta['href'])+'">'+esc(cta['label'])+'</a></section>'
    return '<div class="fin-page">'+body+'</div>'

def curated_pages():
    return [(path,payload) for path,payload in generated_page_paths().items() if not path.startswith(('/workspace','/asset','/app'))]

def home(query):
    p=parse_qs(query);code=p.get('market',['global'])[0];code=code if code in BY_CODE else 'global'
    country=BY_CODE[code]['countryName'] if code!='global' else 'Global markets'
    ranking_path='/markets/'+code+'/valuation' if code!='global' else '/markets'
    rows=valuation_assets(code if code!='global' else None,asset_type='crypto' if code=='crypto' else 'stocks')[:10];overview=market_valuation(code) if code!='global' else {'valuationScore':None,'summary':'Explore native-currency prices and relative valuation screens across 18 markets. Choose a country to focus your research.'}
    from market_pages import table
    hero='<section class="fin-hero"><div><span class="fin-pill">✦ YOUR NEXT RESEARCH QUESTION STARTS HERE</span><h1>Understand markets.<br><span>Grow with insight.</span></h1><p>Discover assets, compare valuations and connect market trends to your portfolio. Financial research, with AI in your corner.</p><div class="fin-actions"><a class="primary" data-selected-market href="'+ranking_path+'">Explore market valuations ↗</a><a href="/workspace">Open your workspace →</a></div><p class="small muted">18 markets · Stocks, crypto, ETFs & indexes · Public research</p></div><aside class="fin-hero-panel"><div class="fin-section-heading"><strong>Market lens</strong><span class="fin-pill">MOCK PREVIEW</span></div><h3>'+esc(country)+'</h3><div class="fin-hero-score"><strong>'+esc(overview['valuationScore'] if overview['valuationScore'] is not None else '—')+'</strong><span>Relative valuation score / 100</span></div><p>'+esc(overview['summary'])+'</p><a href="'+ranking_path+'">See the methodology →</a></aside></section>'
    links=[x for x in curated_pages() if code=='global' or x[1]['marketCode']==code]
    if code!='global' and len(links)<4:
        links += [('/markets/'+code+'/valuation?valuation='+v,{'title':label+' in '+country,'template':'valuation-screen'}) for v,label in [('undervalued','Below Peer Multiples'),('dividend','Dividend Research'),('growth','Growth Research'),('fair','Near Peer Multiples')]]
    links=links[:8]
    cards=[card(payload['title'],'Valuation, market context and a focused research checklist.',path,payload['template'].replace('-',' ').title()) for path,payload in links]
    body='<div class="fin-page">'+hero+'<section id="public-ai" aria-label="Free asset research assistant"></section><div class="fin-section-heading"><div><span class="eyebrow">VALUE BEFORE NOISE</span><h2>Find your next research idea</h2></div><a href="/research">All research →</a></div>'+notice()+grid(cards[:4])+'<div class="fin-section-heading"><h2>'+esc(country)+' valuation rankings</h2><a href="'+ranking_path+'">View all →</a></div>'+table(rows,'1d')+'<div class="fin-section-heading"><h2>Your market. A global perspective.</h2><a href="/markets">18 supported markets →</a></div>'+grid([card(m['flag']+' '+m['countryName'],m['topIndexName']+' · '+m['currency'],'/markets/'+m['marketCode'],'MARKET') for m in MARKETS[:6]])+'<div class="fin-section-heading"><h2>News, charts and portfolio intelligence</h2></div>'+grid([card('Market charts','Explore interactive price charts and market data.','/#charts','CHARTS'),card('Financial news','Follow market headlines and their sources.','/#news','NEWS'),card('Portfolio research','Import holdings, review concentration and save research.','/workspace/portfolio','PLUS'),card('Sharebajar on mobile','One financial research system across web, iOS and Android.','/app','MOBILE')])+'</div>'
    return render_shell(body,'Sharebajar | Market Research, Valuations & Portfolio Intelligence','Explore global stock and crypto rankings, market valuations, asset prices and trends with portfolio research and AI-assisted analysis.','/')

def hub(path):
    titles={'/research':('Research with a thesis','Valuation screens, market themes and evidence-led portfolio questions.'),'/trends':('Understand what is moving markets','Connect supplied catalysts, sector momentum and investor interest to assets.'),'/compare':('Compare before you commit','Review valuation, growth, yield and price momentum side by side.'),'/learn':('Build your investing knowledge','Market-specific guides, valuation basics and practical research habits.'),'/campaigns':('Focused financial research','Explore timely investing themes with coherent asset screens.')}
    title,desc=titles[path];items=curated_pages()
    if path!='/research':items=[x for x in items if x[0].startswith(path+'/')]
    body='<div class="fin-page">'+heading(title,desc)+notice()+grid([card(v['title'],'Explore '+BY_CODE[v['marketCode']]['countryName']+' through '+v['template'].replace('-',' ')+' and illustrative market data.',k,v['template'].replace('-',' ').title()) for k,v in items])
    if path=='/research':
        body+='<div class="fin-section-heading"><h2>Research by market valuation</h2></div>'+grid([card(m['flag']+' '+m['countryName'],'Filter relative valuation, dividends and growth.','/markets/'+m['marketCode']+'/valuation','VALUATION') for m in MARKETS])
    return render_shell(body+'</div>',title+' | Sharebajar',desc+' Compare market rankings, prices, trends and AI-assisted portfolio research.',path)

def pricing():
    body='<div class="fin-page">'+heading('A research plan for your next stage','Start with public markets. Add portfolio insight. Develop a deeper research workflow.')+'<div class="fin-pricing">'
    for plan in PRICING:
        body+='<section class="fin-price '+('fin-price-featured' if plan['id']=='plus' else '')+'"><span class="eyebrow">'+plan['name'].upper()+'</span><h2>'+plan['name']+'</h2><p class="fin-price-value">$'+str(plan['monthlyPrice'])+'<small>/ month</small></p><ul>'+''.join('<li>✓ '+esc(f)+'</li>' for f in plan['features'])+'</ul><button class="primary" data-auth="signup">'+('Create free account' if plan['id']=='free' else 'Explore '+plan['name'])+'</button></section>'
    body+='</div><p class="fin-notice">Public rankings and asset pages require no account. Paid checkout is available when configured by the platform owner. Forecasts are research scenarios; priority refresh requires a live data provider.</p>'+grid([card('See the market first','Public valuations, country rankings and asset research.','/markets','FREE'),card('Your account, across devices','Shared account and portfolio APIs for web, Android and iOS.','/app','MOBILE')])+'</div>'
    return render_shell(body,'Sharebajar Pricing | Free, Plus $19 & Pro $99','Free public rankings and asset prices. Plus AI research and portfolio analysis at $19/month; Pro forecast scenarios and research exports at $99/month.','/pricing')

def app_page(path):
    screen=path.split('/')[-1] if path!='/app' else 'onboarding'
    if screen not in [s['id'] for s in MOBILE_SCREENS]:return None
    body='<div class="fin-page">'+heading('Your research. Wherever you invest.','A shared Sharebajar experience for responsive web, Android and iOS.')+'<p class="fin-notice">Interactive screen previews use mock market data. The Expo app source is included in the repository; store binaries are not published.</p><div class="fin-app-layout"><nav class="fin-screen-nav" aria-label="Mobile screen previews">'+''.join('<a '+('aria-current="page"' if screen==s['id'] else '')+' href="/app/'+s['id']+'">'+esc(s['name'])+'</a>' for s in MOBILE_SCREENS)+'</nav><div id="app-preview" class="fin-phone" data-screen="'+screen+'"><p>Loading mobile screen…</p></div></div></div>'
    return render_shell(body,'Sharebajar Mobile | '+next(s['name'] for s in MOBILE_SCREENS if s['id']==screen),'Mobile-first market rankings, asset prices, trends, AI-assisted research and portfolio analysis for Android and iOS.',path)

def studio():
    body='<div class="fin-page">'+heading('Financial experience generator','Create a draft from a market, valuation screen and supplied trend signals. Review its financial context before publishing.','SHAREBAJAR / INTERNAL RESEARCH TOOLS')+'<div id="financial-studio"><p>Checking administrator access…</p></div></div>'
    return render_shell(body,'Financial Page Generator | Sharebajar','Internal structured financial research generation.','/internal/page-generator',private=True)

def render(path,query=''):
    if path in ['/','/index.html']:return home(query)
    if path in ['/research','/trends','/compare','/learn','/campaigns']:return hub(path)
    if path=='/pricing':return pricing()
    if path=='/about':return render_shell('<div class="fin-page">'+heading('Financial insight, connected','Sharebajar brings market research, portfolio analysis and AI-assisted financial experiences into one product.')+grid([card('Research global markets','Compare stocks, crypto, ETFs and indexes across 18 supported markets.','/markets'),card('Understand portfolio exposure','Connect valuation research to concentration, currency and sector risk.','/workspace'),card('Research on every screen','Shared market models, authentication and financial screen layouts.','/app')])+notice()+'</div>','About Sharebajar | Financial Growth & Research','Sharebajar is an AI-integrated investment research, portfolio analysis and financial growth platform.','/about')
    if path=='/internal/page-generator':return studio()
    if path=='/app' or path.startswith('/app/'):return app_page(path)
    if path in generated_page_paths():
        payload=generated_page_paths()[path];page=generate_page(payload,base_url())
        if page['visibility']!='public':return None
        return render_shell(research_body(page),page['seo']['title'],page['metaDescription'],path,page['jsonLd'])
    if path.startswith('/research/generated/'):
        page=get_published(path.rsplit('/',1)[-1])
        if page and page['visibility']=='public':
            # Published canonical and schema are rewritten when a draft gets its final route.
            old=page['canonicalUrl'];new=base_url()+path
            page=json.loads(json.dumps(page).replace(old,new));page['path']=path
            return render_shell(research_body(page),page['seo']['title'],page['metaDescription'],path,page['jsonLd'])
    return None

def public_paths():
    return ['/research','/trends','/compare','/learn','/pricing','/about','/campaigns','/app']+[p for p,v in curated_pages()]+['/app/'+s['id'] for s in MOBILE_SCREENS]+published_paths()

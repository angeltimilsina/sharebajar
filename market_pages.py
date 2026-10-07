"""Server-rendered public ranking pages and crawlable SEO routes."""
import html,json,os,re
from urllib.parse import quote,parse_qs
from market_catalog import MARKETS,BY_CODE,TYPES,SECTORS,assets_for,all_assets,ranked_assets
ROOT=__import__('pathlib').Path(__file__).parent
esc=lambda v:html.escape(str(v),quote=True)
BASE=lambda:os.environ.get('SHAREBAJAR_PUBLIC_URL','http://localhost:3000').rstrip('/')
LABELS={'stocks':'Stocks','crypto':'Crypto Assets','etfs':'ETFs','indexes':'Indexes','gainers':'Gainers','losers':'Losers','trending':'Trending Assets','most-watched':'Most Watched Assets'}

def market_url(code=''):return '/markets'+('/'+code if code else '')
def asset_url(a):return '/asset/'+a['marketCode']+'/'+quote(a['symbol'],safe='')
def money(a):return BY_CODE[a['marketCode']]['currencySymbol']+format(a['price'],',.2f')
def compact(v):return format(v/1e9,'.2f')+'B' if v>=1e9 else format(v/1e6,'.1f')+'M'

def parse_route(path):
    parts=path.strip('/').split('/')
    if parts==['markets']:return dict(kind='market',code='',view='',sector='')
    if parts[0]=='markets' and len(parts)>=2 and parts[1] in BY_CODE:
        if len(parts)==2:return dict(kind='market',code=parts[1],view='',sector='')
        if len(parts)==3 and parts[2] in TYPES:return dict(kind='market',code=parts[1],view=parts[2],sector='')
        if len(parts)==4 and parts[2]=='sectors' and parts[3] in SECTORS+['digital-assets','diversified']:return dict(kind='market',code=parts[1],view='',sector=parts[3])
    if parts[0]=='asset' and len(parts)==3 and parts[1] in BY_CODE:
        from urllib.parse import unquote
        symbol=unquote(parts[2])
        a=next((a for a in assets_for(parts[1]) if a['symbol'].upper()==symbol.upper()),None)
        if a:return dict(kind='asset',code=parts[1],asset=a)
    return None

def metadata(route):
    code=route['code'];market=BY_CODE.get(code);country=market['countryName'] if market else 'Global Markets'
    if route['kind']=='asset':
        a=route['asset'];heading=a['name']+' ('+a['symbol']+')';title=heading+' Price & Research | Sharebajar'
        description='Explore '+a['name']+' in '+country+': prices, market rankings, trends, portfolio research, and AI-assisted analysis. Mock market data preview.'
    else:
        view=route['view'];sector=route['sector']
        if sector:heading=sector.replace('-',' ').title()+' Stocks in '+country
        elif view=='crypto' or (code=='crypto' and not view):heading='Top Crypto Assets Globally'
        elif view in ['gainers','losers']:heading='Top '+LABELS[view]+' in '+country
        elif view in ['trending','most-watched']:heading=LABELS[view]+' in '+country
        elif view:heading='Top '+LABELS[view]+' in '+country
        else:heading=country+' Market Rankings' if code else 'Global Market Rankings'
        title=('US Stock Market Rankings' if code=='us' and not view else heading)+' | Sharebajar'
        description='Explore '+country+' '+(LABELS.get(view,'asset'))+' rankings, prices and trends. Compare investments with portfolio research and AI-assisted analysis. Mock data preview.'
    return heading,title,description

def breadcrumbs(route,path):
    items=[('Home','/'),('Markets','/markets')]
    if route['code']:items.append((BY_CODE[route['code']]['countryName'],market_url(route['code'])))
    if route['kind']=='asset':items.append((route['asset']['name'],path))
    elif route.get('view'):items.append((LABELS[route['view']],path))
    elif route.get('sector'):items.append((route['sector'].title(),path))
    return items

def table(rows,period):
    out='<div class="table-wrap"><table class="seo-ranking-table"><thead><tr><th>#</th><th>Asset</th><th>Market / Exchange</th><th>Price</th><th>'+esc(period)+' change</th><th>Market cap</th><th>Volume</th><th>Sector</th></tr></thead><tbody>'
    for i,a in enumerate(rows):
        delta=a['changes'][period]
        out+='<tr><td>'+str(i+1)+'</td><td><a class="seo-asset-link" href="'+asset_url(a)+'"><strong>'+esc(a['name'])+'</strong><small>'+esc(a['symbol'])+' · '+esc(a['assetType'].upper())+'</small></a></td><td>'+esc(BY_CODE[a['marketCode']]['countryName'])+'<small>'+esc(a['exchange'])+'</small></td><td>'+money(a)+'</td><td class="'+('up' if delta>=0 else 'down')+'">'+format(delta,'+.2f')+'%</td><td>'+esc(BY_CODE[a['marketCode']]['currencySymbol'])+compact(a['marketCap'])+'</td><td>'+compact(a['volume'])+'</td><td><a href="'+market_url(a['marketCode'])+'/sectors/'+a['sector']+'">'+esc(a['sector'].replace('-',' ').title())+'</a></td></tr>'
    return out+'</tbody></table></div>' if rows else '<p class="seo-empty">No mock assets match these filters. Choose another sector or asset type.</p>'

def overview(code,period):
    rows=assets_for(code) if code else all_assets();ordered=sorted(rows,key=lambda a:a['changes'][period]);index=next((a for a in rows if a['assetType']=='indexes'),rows[0]);index=dict(index,name='Total Crypto Market Cap',price=sum(a['marketCap'] for a in rows)) if code=='crypto' else index;leaders=[('Market Index',index),('Top Gainers',ordered[-1]),('Top Losers',ordered[0]),('Trending',max(rows,key=lambda a:a['trendingScore'])),('Most Watched',max(rows,key=lambda a:a['watchCount'])),('Highest Volume',max(rows,key=lambda a:a['volume']))]
    return '<div class="seo-overview">'+''.join('<a href="'+(market_url(code) if code=='crypto' and label=='Market Index' else asset_url(a))+'"><small>'+label+'</small><strong>'+esc(a['name'])+'</strong><span>'+money(a)+' <em class="'+('up' if a['changes'][period]>=0 else 'down')+'">'+format(a['changes'][period],'+.2f')+'%</em></span></a>' for label,a in leaders)+'</div>'

def market_content(route,query):
    code=route['code'];view=route['view'];sector=route['sector'];heading,_,_=metadata(route);market=BY_CODE.get(code);country=market['countryName'] if market else 'global markets';p=parse_qs(query)
    period=p.get('range',['1d'])[0];kind=p.get('type',[''])[0];filter_sector=p.get('sector',[sector])[0]
    if period not in ['1d','7d','1mo','1y']:period='1d'
    if kind not in ['', 'stocks','crypto','etfs','indexes']:kind=''
    if filter_sector not in ['',*SECTORS,'diversified','digital-assets']:filter_sector=''
    rows=ranked_assets(code or None,view,filter_sector,kind,period)
    nav='<nav class="seo-type-nav" aria-label="Related market rankings"><a href="'+market_url(code)+'">All assets</a>'+''.join('<a '+('aria-current="page"' if view==v else '')+' href="'+market_url(code)+'/'+v+'">'+label+'</a>' for v,label in LABELS.items())+'</nav>' if code else ''
    grid='<div class="seo-market-grid">'+''.join('<a href="'+market_url(m['marketCode'])+'"><span>'+m['flag']+'</span><strong>'+esc(m['countryName'])+'</strong><small>'+esc(m['topIndexName'])+' · '+m['currency']+'</small></a>' for m in MARKETS)+'</div>' if not code else ''
    filters='<form class="seo-filters" method="get"><label>Asset type<select name="type">'+''.join('<option value="'+v+'" '+('selected' if kind==v else '')+'>'+label+'</option>' for v,label in [('', 'All types'),('stocks','Stocks'),('crypto','Crypto'),('etfs','ETFs'),('indexes','Indexes')])+'</select></label><label>Sector<select name="sector">'+''.join('<option value="'+s+'" '+('selected' if filter_sector==s else '')+'>'+('All sectors' if not s else s.replace('-',' ').title())+'</option>' for s in ['',*SECTORS,'diversified','digital-assets'])+'</select></label><label>Time range<select name="range">'+''.join('<option value="'+r+'" '+('selected' if period==r else '')+'>'+l+'</option>' for r,l in [('1d','1 day'),('7d','7 days'),('1mo','1 month'),('1y','1 year')])+'</select></label><button type="submit">Apply filters</button></form>'
    intro='Explore '+country+' market rankings, asset prices and '+LABELS.get(view,'market')+' trends. Compare stocks, ETFs, indexes and global crypto assets, then open an asset for price context, portfolio research and AI-assisted analysis. This public preview uses illustrative mock data.'
    return '<h1>'+esc(heading)+'</h1><p class="seo-intro">'+esc(intro)+'</p>'+grid+overview(code,period)+nav+filters+'<p class="small muted">'+str(len(rows))+' mock assets · Values in each asset’s native currency · '+esc(period)+' illustrative change</p>'+table(rows,period)+'<section class="seo-related"><h2>Explore related markets</h2>'+''.join('<a href="'+market_url(m['marketCode'])+'">'+m['flag']+' '+esc(m['countryName'])+'</a>' for m in MARKETS)+'</section>'

def asset_content(route):
    a=route['asset'];market=BY_CODE[route['code']];points=a['history'];lo=min(points);hi=max(points);coords=' '.join(str(i/(len(points)-1)*700)+','+str(180-(v-lo)/(hi-lo or 1)*150) for i,v in enumerate(points))
    chart='<svg class="seo-mock-chart" viewBox="0 0 700 200" role="img" aria-label="Illustrative mock price history"><polyline points="'+coords+'" fill="none" stroke="#16a34a" stroke-width="3"/></svg>'
    return '<div class="seo-asset-heading"><div><span class="eyebrow">'+esc(market['countryName'])+' · '+esc(a['exchange'])+'</span><h1>'+esc(a['name'])+' <span class="muted">'+esc(a['symbol'])+'</span></h1></div><a href="'+market_url(route['code'])+'/'+a['assetType']+'">Back to '+esc(market['countryName'])+' rankings →</a></div><div class="seo-asset-price">'+money(a)+' <small class="'+('up' if a['changes']['1d']>=0 else 'down')+'">'+format(a['changes']['1d'],'+.2f')+'% · mock 1d change</small></div><section class="box"><h2>Illustrative price history</h2>'+chart+'<p class="small muted">Mock series for layout preview. This is not historical or live market data.</p></section><div class="seo-asset-facts">'+''.join('<div><small>'+key+'</small><strong>'+esc(value)+'</strong></div>' for key,value in [('Market',market['countryName']),('Currency',a['currency']),('Exchange',a['exchange']),('Asset type',a['assetType'].upper()),('Sector',a['sector'].title()),('Mock market cap',market['currencySymbol']+compact(a['marketCap'])),('Mock volume',compact(a['volume'])),('Mock watch count',str(a['watchCount']))])+'</div><section class="asset-login-benefits"><div class="eyebrow">YOUR RESEARCH WORKSPACE</div><h2>Follow '+esc(a['name'])+' with ShareBajar</h2><p>Create an account to access watchlists, recorded portfolios and research tools. AI-assisted analysis depends on plan eligibility and live provider coverage.</p><button data-market-auth="login">Sign in</button><button class="primary" data-market-auth="signup">Create an account</button></section><section class="seo-related"><h2>More from '+esc(market['countryName'])+'</h2>'+''.join('<a href="'+asset_url(other)+'">'+esc(other['name'])+'</a>' for other in assets_for(route['code']) if other['symbol']!=a['symbol'])+'</section>'

def render(path,query=''):
    route=parse_route(path)
    if not route:return None
    path=asset_url(route['asset']) if route['kind']=='asset' else path
    heading,title,description=metadata(route);crumbs=breadcrumbs(route,path)
    body='<div class="seo-market-page"><nav class="seo-breadcrumbs" aria-label="Breadcrumb">'+''.join('<a href="'+url+'">'+esc(name)+'</a>' for name,url in crumbs)+'</nav><div class="seo-mock-banner"><strong>Mock data preview</strong> All prices, returns, rankings, trending scores and watch counts are illustrative. No live listing or local ETF availability is implied.</div>'+(asset_content(route) if route['kind']=='asset' else market_content(route,query))+'</div>'
    structured={'@context':'https://schema.org','@type':'BreadcrumbList','itemListElement':[{'@type':'ListItem','position':i+1,'name':name,'item':BASE()+url} for i,(name,url) in enumerate(crumbs)]}
    head='<meta name="description" content="'+esc(description)+'"><link rel="canonical" href="'+esc(BASE()+path)+'"><meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(description)+'"><meta property="og:url" content="'+esc(BASE()+path)+'"><script type="application/ld+json">'+json.dumps(structured).replace('<','\u003c')+'</script><link rel="stylesheet" href="/market-pages.css">'
    template=(ROOT/'static/index.html').read_text(encoding='utf-8')
    template=re.sub(r'<title>.*?</title>','<title>'+esc(title)+'</title>',template)
    template=template.replace('</head>',head+'</head>').replace('<main id="main" tabindex="-1"></main>','<main id="main" tabindex="-1">'+body+'</main>')
    template=template.replace('<nav id="nav"></nav>','<nav id="nav"><a href="/">Dashboard</a><a href="/markets">Markets</a><a href="/#charts">Charts</a><a href="/markets/crypto">Crypto</a><a href="/#news">News</a></nav>')
    template=template.replace('href="#overview"','href="/"').replace('FREE ? Membership','Sign in / Sign up')
    template=re.sub(r'<script type="module" src="/app.js[^"]*"></script>','<script type="module" src="/market-pages.js"></script>',template)
    return template

def sitemap():
    urls=['/','/markets']
    for m in MARKETS:
        base=market_url(m['marketCode']);urls.append(base);urls.extend(base+'/'+v for v in TYPES)
        urls.extend(base+'/sectors/'+s for s in sorted({a['sector'] for a in assets_for(m['marketCode'])}))
        urls.extend(asset_url(a) for a in assets_for(m['marketCode']))
    return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+''.join('<url><loc>'+esc(BASE()+u)+'</loc></url>' for u in urls)+'</urlset>'

"""One product shell for public research and protected workspace routes."""
import html,json,os,re
from pathlib import Path
ROOT=Path(__file__).parent
esc=lambda value:html.escape(str(value),quote=True)
def base_url():return os.environ.get('SHAREBAJAR_PUBLIC_URL','http://localhost:3000').rstrip('/')
def public_navigation():
    return '<nav id="nav" aria-label="ShareBajar navigation">'+''.join('<a href="'+url+'">'+name+'</a>' for name,url in [('Home','/'),('Markets','/markets'),('Research','/research'),('Trends','/trends'),('Compare','/compare'),('Learn','/learn'),('Pricing','/pricing'),('Workspace','/workspace')])+'</nav>'
def render_shell(body,title,description,path,structured=None,script='financial-pages.js',private=False):
    page=(ROOT/'static/index.html').read_text(encoding='utf-8')
    page=re.sub(r'<title>.*?</title>','<title>'+esc(title)+'</title>',page)
    head='<meta name="description" content="'+esc(description)+'"><link rel="canonical" href="'+esc(base_url()+path)+'"><meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(description)+'"><meta property="og:url" content="'+esc(base_url()+path)+'">'
    if structured is None:structured={'@context':'https://schema.org','@type':'BreadcrumbList','itemListElement':[{'@type':'ListItem','position':1,'name':'Home','item':base_url()+'/'}]+([{'@type':'ListItem','position':2,'name':title.split(' | ')[0],'item':base_url()+path}] if path!='/' else [])}
    if structured:head+='<script type="application/ld+json">'+json.dumps(structured,ensure_ascii=False).replace('<',chr(92)+'u003c')+'</script>'
    if private:head+='<meta name="robots" content="noindex,nofollow">'
    for css in ['financial-system.css','growth-workspace.css']:
        head+='<link rel="stylesheet" href="/'+css+'">'
    page=page.replace('</head>',head+'</head>').replace('<main id="main" tabindex="-1"></main>','<main id="main" tabindex="-1">'+body+'</main>')
    page=page.replace('<nav id="nav"></nav>',public_navigation()).replace('href="#overview"','href="/"').replace('FREE ? Membership','Sign in / Sign up')
    page=page.replace('<button id="currency-button" title="Change portfolio base currency">USD ▾</button>','<button id="currency-button" hidden title="Change portfolio base currency">USD ▾</button>')
    page=re.sub(r'<script type="module" src="/app.js[^"]*"></script>','<script type="module" src="/'+script+'"></script>',page)
    page=page.replace('Quotes may be delayed · Research & tracking only','<a href="/about">About</a> · <a href="/learn">Learn</a> · <a href="/app">Mobile app</a>')
    page=page.replace('</body>','<nav class="fin-mobile-navigation" aria-label="Mobile navigation"><a href="/markets"><span>▥</span>Markets</a><a href="/research"><span>✦</span>Research</a><a href="/workspace/watchlist"><span>☆</span>Watchlist</a><a href="/workspace"><span>◫</span>Portfolio</a></nav></body>')
    return page

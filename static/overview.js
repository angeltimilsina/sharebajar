import {researchHeaders} from './ai.js';
import {defaultMarket,dashboardMetrics,newsLink} from './dashboard.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Date not supplied';

export function renderOverview({state,assets,quotes,activePortfolio,token,isCurrent,api,loadQuotes,asset,title,empty,quoteContainer,money,pct,sign}) {
  const {markets,selected}=defaultMarket(state,assets);
  const holdings=state.holdings.filter(h=>activePortfolio==='All portfolios'||h.portfolio===activePortfolio);
  const indexes=assets.filter(a=>a.type==='Indexes'&&a.country===selected).slice(0,4);
  const watched=state.watchlist.slice(0,4);
  const main=document.querySelector('#main');
  main.innerHTML=title('Portfolio Overview','Your investments and the markets that matter to you.',
    '<button data-refresh>Refresh</button><button class="primary" data-holding>+ Record holding</button>')+`
    <section class="box overview-portfolio"><div class="section-heading"><div><div class="eyebrow">YOUR WEALTH</div><h2>Portfolio snapshot</h2></div><select id="overview-portfolio-filter" aria-label="Dashboard portfolio"><option>All portfolios</option>${state.portfolios.map(p=>`<option ${p===activePortfolio?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
      <div id="overview-valuation">${holdings.length?'<div class="loading">Fetching holding prices and valuations</div>':empty('Start with your first holding','Record an investment to see its value and performance here.','<button class="primary" data-holding>+ Record holding</button>')}</div>
      <div class="overview-portfolio-footer"><span>Saved on this device · Base currency ${esc(state.currency)}</span><button class="text-button" data-view="portfolio">Manage portfolio →</button></div>
    </section>
    <section class="overview-market"><div class="section-heading"><div><div class="eyebrow">YOUR HOME MARKET</div><h2>Market snapshot</h2></div><label class="default-market">Default market<select id="default-market" aria-label="Default market">${markets.map(m=>`<option ${m===selected?'selected':''}>${esc(m)}</option>`).join('')}</select></label></div>
      ${indexes.length?quoteContainer(indexes):empty('Index coverage unavailable','No index metadata is available for this market.')}
      <p class="muted small" id="overview-market-source">${esc(selected)} · Fetching provider quotes</p>
    </section>
    <div class="overview-bottom"><section class="box overview-news"><div class="section-heading"><div><div class="eyebrow">MARKET UPDATES</div><h2>${esc(selected)} news</h2></div><span class="pill">SOURCED HEADLINES</span></div><div id="overview-news" aria-live="polite"><div class="loading">Fetching market headlines</div></div></section>
      <section class="box overview-watchlist"><div class="section-heading"><h2>Your watchlist</h2><button class="text-button" data-view="watchlist">View all →</button></div>${watched.length?quoteContainer(watched,'table'):empty('Keep an eye on your next investment','Star an asset to follow its latest price.','<button data-view="markets">Explore markets</button>')}</section></div>`;

  const ready=loadQuotes([...holdings.filter(h=>h.asset.type!=='Cash').map(h=>h.asset),...indexes,...watched],token);
  ready.then(()=>{
    if(!isCurrent(token))return;
    const available=indexes.map(a=>quotes[a.id]).filter(q=>q&&!q.error);
    const sources=[...new Set(available.map(q=>q.source).filter(Boolean))];
    document.querySelector('#overview-market-source').textContent=selected+' · '+(sources.length?'Quotes: '+sources.join(', ')+' · May be delayed':indexes.length?'Quotes unavailable from provider':'Index coverage unavailable');
  });
  if(holdings.length)loadValuation();
  loadNews();

  async function loadValuation() {
    await ready;
    if(!isCurrent(token))return;
    let fx={rates:{[state.currency]:1}},fxError='';
    if(holdings.some(h=>h.currency!==state.currency||(quotes[h.asset.id]?.currency||h.asset.currency)!==state.currency)) {
      try {fx=await api('fx?base='+encodeURIComponent(state.currency));}
      catch {fxError='FX rates unavailable. Holdings that require conversion are excluded.';}
    }
    if(!isCurrent(token))return;
    const metrics=dashboardMetrics(holdings,quotes,fx,state.currency);
    const {value,gain,daily,rows,missing,valued}=metrics;
    const preview=[...rows].sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity)).slice(0,5);
    document.querySelector('#overview-valuation').innerHTML=`<div class="stats overview-stats">
      <div class="stat overview-total"><span>${missing?'Valued holdings subtotal':'Total portfolio value'}</span><strong>${money(value,state.currency)}</strong><small>${valued} of ${holdings.length} holdings valued</small></div>
      <div class="stat"><span>${missing?"Valued holdings' daily change":"Today's change"}</span><strong class="${sign(daily)}">${money(daily,state.currency)}</strong><small>Price movement at current FX</small></div>
      <div class="stat"><span>Unrealized gain / loss</span><strong class="${sign(gain)}">${money(gain,state.currency)}</strong><small>Against recorded cost basis</small></div>
      <div class="stat"><span>Recorded holdings</span><strong>${holdings.length}</strong><small>${activePortfolio==='All portfolios'?state.portfolios.length+' portfolios':esc(activePortfolio)}</small></div></div>
      ${fxError?`<div class="notice">${esc(fxError)}</div>`:''}${missing?`<div class="notice">${missing} holding(s) lack a usable quote or FX rate. Totals cover valued holdings only.</div>`:''}
      <div class="overview-holdings-heading"><h3>Your largest holdings</h3><span>${preview.length} of ${holdings.length} holdings</span></div><div class="table-wrap"><table><thead><tr><th>ASSET</th><th>VALUE · ${esc(state.currency)}</th><th>UNREALIZED GAIN</th></tr></thead><tbody>${preview.map(r=>`<tr><td><button class="asset-link" ${r.h.asset.type==='Cash'?'data-view="portfolio"':`data-asset="${esc(r.h.asset.id)}"`}><span class="asset-icon">${esc(r.h.asset.symbol.slice(0,3))}</span><span><strong>${esc(r.h.asset.name)}</strong><small>${esc(r.h.asset.symbol)} · ${esc(r.h.portfolio)}</small></span></button></td><td>${money(r.value,state.currency)}</td><td class="${sign(r.gain)}">${money(r.gain,state.currency)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function loadNews() {
    try {
      const data=await api('news?market='+encodeURIComponent(selected),{headers:researchHeaders()});
      if(!isCurrent(token))return;
      const articles=(data.articles||[]).filter(a=>a.title&&a.publisher&&newsLink(a.url));
      const feed=newsLink(data.feedUrl);
      document.querySelector('#overview-news').innerHTML=(articles.length?`<div class="news-list">${articles.map(a=>`<article class="news-item"><div class="news-meta"><span>${esc(a.publisher)}</span><time ${a.publishedAt?`datetime="${esc(a.publishedAt)}"`:''}>${esc(date(a.publishedAt))}</time></div><a href="${esc(newsLink(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.title)}<span aria-hidden="true"> ↗</span></a></article>`).join('')}</div>`:empty('No recent headlines','The feed returned no sourced headlines for this market.'))+`<div class="news-feed-meta"><span>${esc(data.source||'News feed')} · Retrieved ${esc(date(data.fetchedAt))}</span>${feed?`<a href="${esc(feed)}" target="_blank" rel="noopener noreferrer">View feed ↗</a>`:''}</div><p class="muted small">Headlines cover the selected market and open through the news feed. They are not personalized to your holdings.</p>`;
    } catch(error) {
      if(isCurrent(token))document.querySelector('#overview-news').innerHTML=empty('Market news unavailable',esc(error.message),'<button data-refresh>Retry updates</button>');
    }
  }
}

import {request} from './platform.js';
import {chartMarkup,mountPriceChart,disposePriceCharts} from './price-chart.js';
import {researchAccount} from './ai.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:''}catch{return ''}};
const num=v=>Number.isFinite(v)?new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(v):'—';
let cleanup;
export function disposeTerminal(){cleanup?.();cleanup=null}
function homeMarket(assets){
 const markets=[...new Set(assets.filter(a=>a.type==='Indexes').map(a=>a.country))];
 try{
  const region=new Intl.Locale(navigator.language).region;
  if(region){
   const country=new Intl.DisplayNames(['en'],{type:'region'}).of(region);
   if(markets.includes(country))return country;
  }
 }catch{}
 try{
  const preferred=JSON.parse(localStorage.getItem('sharebajar-v1')||'{}').defaultMarket;
  if(markets.includes(preferred))return preferred;
 }catch{}
 return markets.includes('United States')?'United States':markets[0]||'Global';
}
export function renderTerminal(root){
 disposeTerminal();
 let active=true,category='all',market='Global',assets=[],quotes={},selected='',newsSeq=0,chartSeq=0,searchSeq=0,refreshing=false;
 const signedIn=researchAccount().signedIn;
 const alive=()=>active&&root.isConnected;
 root.innerHTML=`<div class="terminal"><header class="tm-header"><a href="#home" class="tm-brand" aria-label="Sharebajar home"><span class="tm-original-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg></span>sharebajar<span class="tm-original-dot">.</span></a><form id="tm-command"><label class="sr-only" for="tm-command-input">Search asset name or ticker</label><span>⌕</span><input id="tm-command-input" placeholder="Search asset or ticker /" maxlength="100" required><button type="submit">Search</button></form><div class="tm-account"><span id="tm-clock"></span><button data-view="signin">${signedIn?'Account':'Sign in'}</button><button data-view="signup">Get started</button></div></header><div class="tm-functions"><button data-view="charts">Charts & AI</button><button data-view="portfolio">Portfolio</button><button data-view="analysis">Research</button><button data-view="watchlist">Watchlist</button><span>PROVIDER DATA · QUOTES MAY BE DELAYED</span></div><div class="tm-ticker" id="tm-ticker"><span>Loading market updates…</span></div><section class="tm-intro"><div><p class="tm-eyebrow">THE DAILY BRIEF</p><h1>A clearer view of the markets.</h1><p>Latest headlines, market movements, and thoughtful research. All in one place.</p></div><a href="#charts" class="tm-intro-link">Explore charts &amp; AI <span aria-hidden="true">&rarr;</span></a></section><div class="tm-grid"><aside class="tm-panel tm-categories"><div class="tm-panel-bar">Discover news</div><div id="tm-categories"></div><div class="tm-sidebar-note">Google News RSS<br>Last 24 hours · newest first<br>Feed headlines, not article bodies.</div></aside><section class="tm-panel tm-news"><div class="tm-panel-bar"><span id="tm-news-title">Top stories</span><div><label class="sr-only" for="tm-market">News region</label><select id="tm-market"><option>Global</option></select><button id="tm-refresh" aria-label="Refresh market data and news">↻ Refresh</button></div></div><div class="tm-news-meta"><span id="tm-news-updated">Fetching headlines…</span><span>Latest headlines</span></div><div id="tm-news-list" aria-live="polite"></div><div class="tm-panel-footer">Auto-update every 60 seconds while this screen is visible.</div></section><aside class="tm-right"><section class="tm-panel"><div class="tm-panel-bar">Market overview · <span id="tm-home-market">Local market</span></div><div id="tm-market-list" aria-live="polite"></div><p class="tm-monitor-note">Select an instrument to inspect its chart.</p></section><section class="tm-panel tm-chart"><div class="tm-panel-bar"><span id="tm-chart-name">Price history</span><span>1M</span></div><div id="tm-chart"></div><div id="tm-chart-source" class="tm-panel-footer"></div></section><section class="tm-panel"><div class="tm-panel-bar">A little clarity, powered by AI</div><div class="tm-research"><button data-view="charts">Open chart &amp; AI review →</button><button data-view="signin">Add your portfolio →</button></div></section></aside></div><div class="tm-status"><span><i></i> Sharebajar · Make sense of the markets</span><span id="tm-status">Connecting to providers…</span><span>Your local time</span></div></div>`;
 const $=s=>root.querySelector(s);
 $('.tm-research').insertAdjacentHTML('afterbegin','<ul class="tm-feature-list"><li>AI analysis</li><li>Detailed fundamentals</li><li>Reports &amp; analysis</li></ul>');
 const clock=()=>{$('#tm-clock').textContent=new Date().toLocaleTimeString(undefined,{hour12:false})};
 clock();
 async function loadNews(){
  const ticket=++newsSeq;
  $('#tm-news-list').innerHTML='<p class="tm-empty">Fetching sourced headlines…</p>';
  try{
   const feed=await request('news/feed?'+new URLSearchParams({category,market}));
   if(!alive()||ticket!==newsSeq)return;
   $('#tm-news-title').textContent=feed.categoryTitle||category;
   $('#tm-news-updated').textContent='Updated '+new Date(feed.fetchedAt).toLocaleTimeString()+' · Last 24 hours';
   const articles=(feed.articles||[]).filter(a=>a.title&&safe(a.url));
   const visible=signedIn?articles:articles.slice(0,3);
   $('#tm-news-list').innerHTML=visible.length?visible.map((a,i)=>`<article class="tm-news-row"><span class="tm-news-number">${String(i+1).padStart(2,'0')}</span><div><a href="${esc(safe(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a><div class="tm-news-source">${esc(a.publisher)} <span>↗ SOURCE</span></div></div><time>${esc(a.publishedAt?new Date(a.publishedAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}):'Time unavailable')}</time></article>`).join(''):'<p class="tm-empty">No sourced headlines returned for this category and region.</p>';
   if(!signedIn&&articles.length)$('#tm-news-list').insertAdjacentHTML('beforeend','<div class="tm-login-more"><button data-view="signin">Log in to view more stories →</button></div>');
   $('#tm-status').textContent='News updated · '+market;
  }catch(error){
   if(alive()&&ticket===newsSeq){$('#tm-news-list').innerHTML=`<p class="tm-empty" role="alert">${esc(error.message)}<br>Use Refresh to retry.</p>`;$('#tm-status').textContent='News unavailable'}
  }
 }
 async function loadChart(id){
  selected=id;
  const ticket=++chartSeq,a=assets.find(item=>item.id===id);
  if(!a)return;
  disposePriceCharts($('#tm-chart'));
  $('#tm-chart-name').textContent=a.symbol;
  $('#tm-chart').innerHTML=chartMarkup('tm-price-chart',{symbol:a.symbol,currency:a.currency});
  try{
   const [q]=await request('quotes?symbols='+encodeURIComponent(id)+'&range=1mo');
   if(!alive()||ticket!==chartSeq)return;
   if(!q||q.error)throw Error(q?.error||'Quote unavailable');
   await mountPriceChart($('#tm-price-chart'),{...q,symbol:a.symbol,currency:q.currency||a.currency,color:'#6001d2',period:'1mo'});
   $('#tm-chart-source').textContent=(q.source||'Provider')+' · '+(q.updatedAt?new Date(typeof q.updatedAt==='number'?q.updatedAt*1000:q.updatedAt).toLocaleString():'Timestamp unavailable');
  }catch(error){
   if(alive()&&ticket===chartSeq){$('#tm-chart').innerHTML=`<p class="tm-empty">${esc(error.message)}</p>`;$('#tm-chart-source').textContent='Price history unavailable'}
  }
 }
 async function loadMarkets(){
  const all=assets.filter(a=>a.type==='Indexes');
  const local=all.filter(a=>a.country===market);
  const monitor=(local.length?local:all).slice(0,4);
  $('#tm-home-market').textContent=local.length?market:'Global';
  if(!monitor.length){$('#tm-market-list').innerHTML='<p class="tm-empty">No market indexes available.</p>';$('#tm-ticker').textContent='Market catalog unavailable';return}
  try{
   const data=await request('quotes?symbols='+encodeURIComponent(monitor.map(a=>a.id).join(',')));
   if(!alive())return;
   data.forEach(q=>quotes[q.id]=q);
   const row=a=>{const q=quotes[a.id]||{};return `<button data-tm-asset="${esc(a.id)}"><span>${esc(a.symbol)}<small>${esc(a.name)}</small></span><strong>${q.error?'N/A':num(q.price)}</strong><em class="${q.changePercent<0?'tm-down':'tm-up'}">${Number.isFinite(q.changePercent)?(q.changePercent>=0?'+':'')+num(q.changePercent)+'%':'—'}</em></button>`};
   $('#tm-market-list').innerHTML=monitor.map(row).join('');
   $('#tm-ticker').innerHTML=monitor.map(row).join('');
   if(!selected||!local.some(a=>a.id===selected))loadChart(monitor[0].id);
  }catch(error){
   if(alive()){$('#tm-market-list').innerHTML=`<p class="tm-empty">${esc(error.message)}</p>`;$('#tm-ticker').textContent='Market updates unavailable'}
  }
 }
 async function refresh(){
  if(refreshing||!alive())return;
  refreshing=true;$('#tm-refresh').disabled=true;
  await Promise.allSettled([loadNews(),loadMarkets()]);
  if(alive())$('#tm-refresh').disabled=false;
  refreshing=false;
 }
 root.onclick=e=>{const button=e.target.closest('[data-tm-asset]');if(button)loadChart(button.dataset.tmAsset)};
 $('#tm-refresh').onclick=refresh;
 $('#tm-market').onchange=e=>{market=e.target.value;selected='';loadNews();loadMarkets()};
 $('#tm-command').onsubmit=async e=>{
  e.preventDefault();
  const ticket=++searchSeq;
  $('#tm-status').textContent='Searching assets…';
  try{
   const result=await request('search?q='+encodeURIComponent($('#tm-command-input').value.trim()));
   if(!alive()||ticket!==searchSeq)return;
   const found=result.assets||[];
   if(!found.length){$('#tm-status').textContent='No matching assets found';return}
   for(const a of found)if(!assets.some(item=>item.id===a.id))assets.push(a);
   $('#tm-status').textContent='Selected '+found[0].symbol;
   loadChart(found[0].id);
  }catch(error){if(alive())$('#tm-status').textContent=error.message}
 };
 const key=e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){e.preventDefault();$('#tm-command-input').focus()}};
 window.addEventListener('keydown',key);
 const timer=setInterval(()=>{if(alive()&&!document.hidden){clock();refresh()}},60000);
 const clockTimer=setInterval(()=>{if(alive()&&!document.hidden)clock()},1000);
 cleanup=()=>{active=false;clearInterval(timer);clearInterval(clockTimer);window.removeEventListener('keydown',key);root.onclick=null;disposePriceCharts(root)};
 (async()=>{
  const results=await Promise.allSettled([request('news/categories'),request('catalog')]);
  if(!alive())return;
  const categories=results[0].status==='fulfilled'?results[0].value:{categories:[{id:'all',title:'Top stories'}],markets:['Global']};
  assets=results[1].status==='fulfilled'?results[1].value.assets||[]:[];
  const preferred=homeMarket(assets);
  const available=categories.markets||['Global'];
  market=available.includes(preferred)?preferred:'Global';
  $('#tm-categories').innerHTML=(categories.categories||[]).map((c,i)=>`<button data-tm-category="${esc(c.id)}" class="${c.id===category?'active':''}"><span>${String(i+1).padStart(2,'0')}</span>${esc(c.title)}</button>`).join('');
  $('#tm-categories').onclick=e=>{
   const button=e.target.closest('[data-tm-category]');
   if(!button)return;
   category=button.dataset.tmCategory;
   $('#tm-categories').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===button));
   loadNews();
  };
  $('#tm-market').innerHTML=available.map(m=>`<option>${esc(m)}</option>`).join('');
  $('#tm-market').value=market;
  refresh();
 })();
}

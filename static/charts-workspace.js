import {mountPortfolioPlanner} from './portfolio-planner.js';
import {stockMarkets,inStockMarket,stockSearchQuery} from './stock-markets.js';
import {request} from './platform.js';
import {chartMarkup,mountPriceChart,disposePriceCharts} from './price-chart.js';
import {researchAccount,researchHeaders,openMembership} from './ai.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:''}catch{return ''}};
const stamp=value=>value?new Date(value).toLocaleString():'';
let selected='',range='1mo',version=0;

export function renderChartsWorkspace({root,assets,market,isCurrent,initialQuery='',state={holdings:[],currency:'USD'},onAddHolding=()=>{}}){
 disposePriceCharts(root);
 const current=++version;
 const list=assets.filter(a=>a.country===market);
 const choices=[...assets];
 if(!choices.some(a=>a.id===selected))selected=list[0]?.id||choices[0]?.id||'';
 root.innerHTML=`<div class="page-heading"><div><div class="eyebrow">MARKETS AT A GLANCE</div><h1>${researchAccount().signedIn?'Market Charts':'Charts, news & portfolio AI'}</h1><p>Ask about an asset. Get a chart review and the latest news in one place.</p></div><button data-brief-refresh>Refresh</button></div><div class="charts-news-layout"><section class="box charts-workspace"><form id="asset-review-search" class="asset-review-search"><label class="sr-only" for="asset-review-query">Find an asset</label><input id="asset-review-query" type="search" placeholder="Find an asset, e.g. Apple or BTC" maxlength="100" required><button type="submit">Find asset</button></form><p id="asset-review-search-status" role="status"></p><div class="charts-workspace-controls"><label>Asset category<select id="explore-category"><option value="">All assets</option>${[...new Set(assets.map(a=>a.type))].sort().map(type=>`<option>${esc(type)}</option>`).join('')}</select></label><label id="explore-stock-market-label" hidden>Stock market<select id="explore-stock-market"><option value="">All stock markets</option>${stockMarkets.map(m=>`<option value="${esc(m.id)}">${esc(m.country)} / ${esc(m.id)}</option>`).join('')}</select></label><label>Instrument<select id="charts-instrument">${choices.map(a=>`<option value="${esc(a.id)}" ${a.id===selected?'selected':''}>${esc(a.name)} · ${esc(a.symbol)}</option>`).join('')}</select></label><label>Market news<select id="charts-news-market">${[...new Set(assets.filter(a=>a.type==='Indexes'&&!['Global','Europe'].includes(a.country)).map(a=>a.country))].sort().map(m=>`<option ${m===market?'selected':''}>${esc(m)}</option>`).join('')}</select></label></div><div class="tabs" role="group" aria-label="Price history range">${['1mo','3mo','1y'].map(r=>`<button data-workspace-range="${r}" class="${range===r?'active':''}" aria-pressed="${range===r}">${r}</button>`).join('')}</div><div id="workspace-chart"></div><p class="muted small">Provider prices may be delayed.</p><form id="asset-review-form" class="asset-review-form"><div class="eyebrow">ASK ABOUT THIS ASSET / PRO</div><h2>Get an AI chart review</h2><label class="sr-only" for="asset-review-question">Ask about the selected asset</label><textarea id="asset-review-question" rows="3" maxlength="2000" required placeholder="What does this chart tell us, and how does the latest news fit in?"></textarea><div class="asset-review-suggestions"><button type="button" data-review-question="Review the chart trend, momentum, and key risks alongside the latest news.">Review the trend</button><button type="button" data-review-question="Summarize the latest news and explain what it can and cannot tell us about this chart.">Explain the news</button></div><button class="primary" type="submit" id="asset-review-submit">${researchAccount().signedIn?'Review this asset':'Sign in for an AI review'}</button><p class="muted small">Pro reviews use provider chart data and sourced headlines. Your question is sent to OpenAI. Historical scenarios are not price targets.</p><div id="asset-review-status" role="status" aria-live="polite"></div></form><section id="asset-review-answer" aria-live="polite"></section></section><aside class="box charts-news"><div class="eyebrow">LATEST MARKET NEWS</div><h2>Briefing · ${esc(market)}</h2><div id="workspace-brief" aria-live="polite"><div class="loading">Preparing the latest news brief…</div></div><div class="news-more"><h3>${researchAccount().signedIn?'Explore the full picture':'Go beyond the headlines'}</h3><p class="muted">${researchAccount().signedIn?'Read the full headline feed or open your research workspace.':'Sign in to view more news, save a watchlist, and explore research.'}</p><button class="primary" data-news-more>${researchAccount().signedIn?'View more news':'Sign in to view more'}</button>${researchAccount().signedIn?'<button data-view="analysis">Open research</button>':''}</div><div id="workspace-more-news" aria-live="polite"></div></aside></div>`;
 root.insertAdjacentHTML('beforeend','<section id="portfolio-planner" class="box portfolio-planner"></section>');mountPortfolioPlanner(root.querySelector('#portfolio-planner'),{state,onAddHolding,isCurrent});
 const alive=()=>current===version&&isCurrent()&&root.querySelector('#workspace-chart');
 let chartVersion=0,briefVersion=0,reviewVersion=0;
 async function loadChart(){
  const ticket=++chartVersion,a=choices.find(a=>a.id===selected),target=root.querySelector('#workspace-chart');
  disposePriceCharts(target);
  if(!a){target.innerHTML='<p class="muted">No instruments available for this market.</p>';return}
  target.innerHTML=chartMarkup('workspace-price-chart',{symbol:a.symbol,currency:a.currency});
  try{const [q]=await request('quotes?symbols='+encodeURIComponent(a.id)+'&range='+range);if(!alive()||ticket!==chartVersion)return;if(!q||q.error)throw Error(q?.error||'Quote unavailable');await mountPriceChart(root.querySelector('#workspace-price-chart'),{...q,color:'#228dcc',symbol:a.symbol,currency:q.currency||a.currency,period:range})}
  catch(e){if(alive()&&ticket===chartVersion)target.innerHTML=`<p class="notice" role="alert">${esc(e.message)}</p>`}
 }
 const headlines=articles=>`<div class="news-list">${articles.filter(a=>safe(a.url)).map(a=>`<article class="news-item"><div class="news-meta"><span>${esc(a.publisher)}</span><time>${esc(stamp(a.publishedAt))}</time></div><a href="${esc(safe(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.title)} ↗</a></article>`).join('')}</div>`;
 async function loadBrief(){
  const ticket=++briefVersion,assetId=selected;const target=root.querySelector('#workspace-brief');root.querySelector('.charts-news h2').textContent='Latest news ? '+(choices.find(a=>a.id===assetId)?.symbol||market);target.innerHTML='<div class="loading">Preparing the latest news brief…</div>';
  try{const data=await request('news/brief?market='+encodeURIComponent(market)+'&asset='+encodeURIComponent(assetId),{timeout:120000});if(!alive()||ticket!==briefVersion)return;target.innerHTML=`<span class="pill">${data.status==='ready'?'AI NEWS SUMMARY':'LATEST HEADLINES'}</span><p class="news-brief-summary">${esc(data.summary||data.message||'No recent headlines available.')}</p><p class="muted small">${data.status==='ready'?'Based on headlines, not full articles. ':''}Updated ${esc(stamp(data.generatedAt||data.fetchedAt))}</p>${headlines(data.articles||[])}`}
  catch(e){if(alive()&&ticket===briefVersion)target.innerHTML=`<p class="notice" role="alert">${esc(e.message)}</p><button data-retry-brief>Retry news brief</button>`}
 }
 function selectAsset(id){selected=id;root.querySelector('#explore-stock-market-label').hidden=!(root.querySelector('#explore-category').value==='Stocks'||choices.find(a=>a.id===id)?.type==='Stocks');reviewVersion++;root.querySelector('#asset-review-submit').disabled=false;root.querySelector('#asset-review-answer').innerHTML='';root.querySelector('#asset-review-status').textContent='';root.querySelector('#workspace-more-news').innerHTML='';loadChart();loadBrief()}
 root.querySelector('#charts-instrument').onchange=e=>selectAsset(e.target.value);
 function filterInstruments(preferred=''){
  const category=root.querySelector('#explore-category').value,marketId=root.querySelector('#explore-stock-market').value;
  const items=choices.filter(a=>(!category||a.type===category)&&(!marketId||category!=='Stocks'||inStockMarket(a,marketId))),picker=root.querySelector('#charts-instrument');
  picker.innerHTML=items.map(a=>`<option value="${esc(a.id)}">${esc(a.symbol)} / ${esc(a.name)}</option>`).join('');
  picker.value=items.some(a=>a.id===preferred)?preferred:items[0]?.id||'';
  root.querySelector('#asset-review-search-status').textContent=items.length?'': 'No catalog stocks in this market. Search for a ticker to discover provider-supported listings.';
  selectAsset(picker.value);
 }
 root.querySelector('#explore-category').onchange=()=>{root.querySelector('#explore-stock-market').value='';filterInstruments(selected)};
 root.querySelector('#explore-stock-market').onchange=()=>{root.querySelector('#explore-category').value='Stocks';filterInstruments(selected)};
 root.querySelector('#asset-review-search').onsubmit=async e=>{
  e.preventDefault();const status=root.querySelector('#asset-review-search-status'),button=e.currentTarget.querySelector('button');button.disabled=true;status.textContent='Finding assets?';
  try{const stockOnly=root.querySelector('#explore-category').value==='Stocks',marketId=root.querySelector('#explore-stock-market').value,query=root.querySelector('#asset-review-query').value.trim();const data=await request('search?q='+encodeURIComponent(stockOnly?stockSearchQuery(query,marketId):query)+(stockOnly?'&type=Stocks':''));if(!alive())return;const found=(data.assets||[]).filter(a=>!stockOnly||(a.type==='Stocks'&&(!marketId||inStockMarket(a,marketId))));status.textContent=found.length?'Choose a result in the instrument selector.':'No assets found. Try another name or ticker.';for(const a of found){if(!choices.some(item=>item.id===a.id)){choices.push(a);const option=document.createElement('option');option.value=a.id;option.textContent=a.symbol+' ? '+a.name;root.querySelector('#charts-instrument').append(option)}}if(found.length){filterInstruments(found[0].id);status.textContent='Showing a matching listing. Choose another result in the instrument selector.'}}catch(error){if(alive())status.textContent=error.message}finally{if(alive())button.disabled=false}
 };
 root.querySelectorAll('[data-review-question]').forEach(button=>button.onclick=()=>{root.querySelector('#asset-review-question').value=button.dataset.reviewQuestion;root.querySelector('#asset-review-question').focus()});
 root.querySelector('#asset-review-form').onsubmit=async e=>{
  e.preventDefault();if(!researchAccount().signedIn)return openMembership();
  const assetId=selected,ticket=++reviewVersion,button=root.querySelector('#asset-review-submit'),status=root.querySelector('#asset-review-status');
  if(!assetId){status.textContent='Choose an asset first.';return}
  button.disabled=true;status.textContent='Reviewing the chart and checking the latest news?';root.querySelector('#asset-review-answer').innerHTML='';
  try{const data=await request('research/chat',{method:'POST',headers:{...researchHeaders(),'Content-Type':'application/json'},body:JSON.stringify({assetId,prompt:root.querySelector('#asset-review-question').value.trim(),chartRange:['1mo','3mo','1y'].includes(range)?range:'3mo',horizon:'1mo'}),timeout:180000});if(!alive()||ticket!==reviewVersion||!researchAccount().signedIn)return;
   const result=data.result||{},interpretation=result.interpretation||{},report=interpretation.report;if(!report)throw Error('The AI review is unavailable. Retry shortly.');
   const citations=ids=>(ids||[]).map(id=>{const source=interpretation.sources?.find(s=>s.id===id);return safe(source?.url)?`<a href="${esc(safe(source.url))}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a>`:''}).join('');
   root.querySelector('#asset-review-answer').innerHTML=`<div class="asset-review-result"><div class="eyebrow">AI CHART REVIEW</div><h2>${esc(choices.find(a=>a.id===assetId)?.symbol||assetId)} review</h2><p class="news-brief-summary">${esc(report.summary)}</p>${(report.sections||[]).map(section=>`<section><h3>${esc(section.heading)}</h3><p>${esc(section.body)}</p><div class="asset-review-citations">${citations(section.evidence_ids)}</div></section>`).join('')}<details><summary>Coverage and limitations</summary><ul>${(report.limitations||[]).map(v=>`<li>${esc(v)}</li>`).join('')}</ul></details><p class="muted small">Updated ${esc(stamp(interpretation.generatedAt||result.generatedAt))}. AI research may be incomplete; verify the sources.</p></div>`;status.textContent='Review ready.';
  }catch(error){if(alive()&&ticket===reviewVersion){status.textContent=error.message;if(error.status===401||error.status===403)openMembership()}}finally{if(alive()&&ticket===reviewVersion)button.disabled=false}
 };
 root.querySelector('#charts-news-market').onchange=e=>{selected=assets.find(a=>a.country===e.target.value)?.id||selected;renderChartsWorkspace({root,assets,state,onAddHolding,market:e.target.value,isCurrent})};
 root.querySelectorAll('[data-workspace-range]').forEach(button=>button.onclick=()=>{range=button.dataset.workspaceRange;root.querySelectorAll('[data-workspace-range]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))});loadChart()});
 root.querySelector('[data-brief-refresh]').onclick=()=>{loadChart();loadBrief()};
 root.querySelector('#workspace-brief').onclick=e=>{if(e.target.closest('[data-retry-brief]'))loadBrief()};
 root.querySelector('[data-news-more]').onclick=async e=>{
  if(!researchAccount().signedIn)return openMembership();
  const button=e.currentTarget,assetId=selected;button.disabled=true;
  try{const data=await request('news?market='+encodeURIComponent(market)+'&asset='+encodeURIComponent(selected),{headers:researchHeaders()});if(alive()&&selected===assetId&&researchAccount().signedIn)root.querySelector('#workspace-more-news').innerHTML=headlines(data.articles||[])}
  catch(error){if(alive())root.querySelector('#workspace-more-news').innerHTML=`<p class="notice">${esc(error.message)}</p>`}
  finally{if(alive())button.disabled=false}
 };
 root.querySelector('#explore-stock-market-label').hidden=choices.find(a=>a.id===selected)?.type!=='Stocks';loadChart();loadBrief();if(initialQuery){root.querySelector('#asset-review-query').value=initialQuery;root.querySelector('#asset-review-search').requestSubmit()}
}

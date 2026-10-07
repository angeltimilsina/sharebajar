import {request} from './platform.js';
import {researchAccount,researchHeaders,openMembership} from './ai.js';
import {mountTechnicalChart,disposeTechnicalCharts} from './technical-chart.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:''}catch{return ''}};
const access=()=>({account:researchAccount(),pro:!!researchAccount().signedIn&&!!researchAccount().features?.assetAI});
const localDate=time=>new Date(time*1000).toISOString().slice(0,10);
const formatPrice=(value,currency='')=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(value)+(currency?' '+currency:''):'Unavailable';
let activeConversation='',historyItems=[],messages=[],selectedAsset='',selectedRange='3mo',selectedHorizon='1mo',rootCleanup;

export function disposeResearchChat(root){rootCleanup?.();rootCleanup=null;disposeTechnicalCharts(root)}

export function renderResearchChat({assets,state,title,onResearch}){
  rootCleanup?.();disposeTechnicalCharts(document.querySelector('#main'));
  const root=document.querySelector('#main'),available=[...new Map([...assets,...state.watchlist,...state.holdings.map(item=>item.asset)].map(item=>[item.id,item])).values()];
  const initial=available.find(asset=>asset.type==='Stocks')||available[0];
  if(!selectedAsset&&initial)selectedAsset=initial.id;
  root.innerHTML=title('Analysis','Search an asset, explore verified market data, and keep your research conversations synced to your account.')+
    `<div class="research-tabs" role="tablist" aria-label="Research workspace"><button id="research-chat-tab" class="active" role="tab" aria-selected="true">AI chat</button><button id="research-studio-tab" role="tab" aria-selected="false">Research studio</button><span class="research-chat-pro">AI CHAT · PRO</span></div>
    <section id="research-chat-panel" class="research-chat-layout" aria-label="AI asset research">
      <aside class="research-chat-sidebar box"><div class="research-chat-sidebar-head"><strong>Research history</strong><button type="button" id="research-new-chat">＋ New chat</button></div><label class="sr-only" for="research-history-search">Search saved research chats</label><input id="research-history-search" type="search" placeholder="Search history"><div id="research-history-list" class="research-history-list" aria-live="polite"></div></aside>
      <div class="research-chat-main">
        <section class="box research-asset-picker"><div class="research-asset-fields"><label>Asset<select id="research-chat-asset" aria-label="Research asset">${available.map(item=>`<option value="${esc(item.id)}">${esc(item.symbol)} · ${esc(item.name)}</option>`).join('')}</select></label><label>Find any market asset<input id="research-chat-search" type="search" placeholder="Search by name or ticker"></label><button type="button" id="research-chat-find">Search</button></div><div id="research-chat-search-results" role="status"></div></section>
        <section class="box research-chart-card"><div class="research-chart-heading"><div><div class="eyebrow">PRICE ACTION · OHLC</div><h2 id="research-chart-title">Market chart</h2></div><label>Chart range<select id="research-chart-range"><option value="1mo">1 month</option><option value="3mo" selected>3 months</option><option value="1y">1 year</option></select></label></div>
          <div class="research-chart-tools"><span class="muted small">Indicators</span><label><input type="checkbox" data-price-indicator="sma20" checked> SMA 20</label><label><input type="checkbox" data-price-indicator="sma50" checked> SMA 50</label><label><input type="checkbox" data-price-indicator="sma200"> SMA 200</label><label><input type="checkbox" data-price-indicator="ema20"> EMA 20</label><label><input type="checkbox" data-price-indicator="bollingerUpper"> Bollinger bands</label><label class="research-horizon-label">Scenario horizon<select id="research-horizon"><option value="1w">1 week</option><option value="1mo" selected>1 month</option><option value="3mo">3 months</option></select></label></div>
          <div id="research-technical-access" class="research-technical-access" hidden></div><div id="research-technical-cards" class="research-technical-cards" hidden></div>
          <div id="research-tech-chart" class="research-tech-chart"><div class="research-tech-price" data-tech-price></div><section class="research-tech-pane"><strong>RSI · 14</strong><div data-tech-rsi></div></section><section class="research-tech-pane"><strong>MACD · 12 / 26 / 9</strong><div data-tech-macd></div></section></div>
          <div class="research-chart-foot"><span data-tech-source>Loading provider candles…</span><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">© TradingView</a></div>
        </section>
        <section class="research-chat-transcript" aria-label="Research conversation"><div id="research-chat-messages"></div><div id="research-chat-status" role="status" aria-live="polite"></div></section>
        <form id="research-chat-form" class="box research-chat-composer"><label class="sr-only" for="research-chat-prompt">Ask about the selected asset</label><textarea id="research-chat-prompt" rows="2" maxlength="2000" placeholder="Ask about this asset’s price action, indicators, fundamentals, or risks…" required></textarea><div class="research-chat-compose-footer"><p class="muted small">AI explanations use dated provider data. Scenario bands summarize historical returns and volatility; they are not price targets.</p><button type="submit" class="primary" id="research-chat-send">Send ↗</button></div></form>
        <div class="research-chat-disclosure muted small">Your question, selected asset and recent conversation context are sent to OpenAI to generate a response. Research may be incomplete and is not financial advice. Candles are provider-sourced; AI does not calculate or invent prices. Do not include sensitive personal information.</div>
      </div>
    </section><section id="research-studio-panel" hidden><div id="research-studio"></div></section>`;
  const $=selector=>root.querySelector(selector),$main=$('#research-chat-panel'),$studio=$('#research-studio-panel');
  if(selectedAsset&&$('#research-chat-asset').querySelector(`option[value="${CSS.escape(selectedAsset)}"]`))$('#research-chat-asset').value=selectedAsset;
  $('#research-chart-range').value=selectedRange;$('#research-horizon').value=selectedHorizon;
  let mountedStudio=false,loading=false,chartSequence=0;
  const signedIn=()=>access().pro;
  const authOptions=()=>researchHeaders();
  const setStatus=(message,error=false)=>{$('#research-chat-status').innerHTML=message?`<div class="${error?'notice research-error':'muted small'}">${esc(message)}</div>`:''};
  const displayAccess=()=>{
    const hasPro=signedIn(),accessPanel=$('#research-technical-access'),cards=$('#research-technical-cards');
    accessPanel.hidden=hasPro;cards.hidden=!hasPro;
    accessPanel.innerHTML=hasPro?'':`<span>Indicators, projections and AI chat are Pro tools.</span><button type="button" data-research-unlock>${researchAccount().signedIn?'Explore Pro':'Sign in to unlock'}</button>`;
    $('#research-chat-form').querySelectorAll('textarea,button').forEach(control=>control.disabled=!hasPro||loading);
    $('#research-new-chat').disabled=!hasPro;
    if(!hasPro){cards.replaceChildren();root.querySelectorAll('[data-price-indicator]').forEach(input=>{input.checked=false;input.disabled=true});root.querySelectorAll('.research-tech-pane').forEach(pane=>pane.hidden=true)}
    else{root.querySelectorAll('[data-price-indicator]').forEach(input=>input.disabled=false);root.querySelectorAll('.research-tech-pane').forEach(pane=>pane.hidden=false)}
    $('#research-history-list').innerHTML=hasPro?historyMarkup():'<p class="muted small">Sign in with Pro to sync chat history across devices.</p>';
  };
  const historyMarkup=()=>{
    const query=$('#research-history-search').value.trim().toLowerCase();
    const items=historyItems.filter(item=>!query||item.title.toLowerCase().includes(query));
    return items.length?items.map(item=>`<div class="research-history-row"><button type="button" data-open-conversation="${esc(item.id)}" class="${activeConversation===item.id?'active':''}"><strong>${esc(item.title)}</strong><small>${new Date(item.updated_at*1000).toLocaleDateString()}</small></button><button type="button" data-delete-conversation="${esc(item.id)}" aria-label="Delete ${esc(item.title)}">×</button></div>`).join(''):'<p class="muted small">Your saved research chats will appear here.</p>';
  };
  const refreshHistory=async()=>{
    if(!signedIn()){historyItems=[];displayAccess();return}
    try{const result=await request('research/conversations',{headers:authOptions()});historyItems=result.conversations||[];$('#research-history-list').innerHTML=historyMarkup()}
    catch(error){$('#research-history-list').innerHTML=`<p class="notice" role="alert">${esc(error.message)}</p>`}
  };
  const renderTranscript=()=>{
    const container=$('#research-chat-messages');
    container.innerHTML=messages.length?messages.map(message=>{
      if(message.role==='user')return `<article class="research-chat-message research-user-message"><span>You</span><p>${esc(message.content)}</p></article>`;
      const result=message.result||message.payload?.result,report=result?.interpretation?.report;
      return `<article class="research-chat-message research-assistant-message"><span>ShareBajar AI</span><p class="research-chat-answer">${esc(message.content)}</p>${report?.sections?.map(section=>`<section class="research-chat-section"><h3>${esc(section.heading)}</h3><p>${esc(section.body)}</p><div class="research-chat-citations">${(section.evidence_ids||[]).map(id=>{const source=result.interpretation.sources?.find(item=>item.id===id),url=safeUrl(source?.url);return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(id)} · ${esc(source.title)}</a>`:`<span>${esc(id)}</span>`}).join('')}</div></section>`).join('')||''}${report?.limitations?.length?`<details><summary>Data limitations</summary><ul>${report.limitations.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>`:''}<small class="muted">AI-generated research. Verify sources before investing.</small></article>`;
    }).join(''):'<div class="research-chat-empty"><span>↗</span><h2>Start an asset research chat</h2><p>Search for an asset, inspect its candlestick chart, then ask a question. Your conversations sync to your account.</p></div>';
    container.scrollTop=container.scrollHeight;
  };
  const updateTechnicalCards=data=>{
    const indicators=data.latestIndicators||{},projection=data.projection||{},items=[['RSI (14)',indicators.rsi14],['SMA (20)',indicators.sma20],['MACD',indicators.macd]];
    $('#research-technical-cards').innerHTML=`<div class="research-indicator-values">${items.map(([label,value])=>`<div><span>${label}</span><strong>${Number.isFinite(value)?formatPrice(value,data.asset.currency):'Not enough history'}</strong></div>`).join('')}</div>${projection.available?`<div class="research-projection"><strong>${esc(projection.horizon)} historical scenario range</strong><span>${formatPrice(projection.lower,data.asset.currency)} – ${formatPrice(projection.upper,data.asset.currency)}</span><small>Mid scenario ${formatPrice(projection.median,data.asset.currency)} · Based on ${projection.historicalReturns} historical returns; not a target.</small></div>`:`<div class="notice">${esc(projection.reason||'Scenario range unavailable.')}</div>`}`;
  };
  const loadChart=async()=>{
    const sequence=++chartSequence,assetId=$('#research-chat-asset').value;
    if(!assetId)return;
    selectedAsset=assetId;selectedRange=$('#research-chart-range').value;selectedHorizon=$('#research-horizon').value;
    const asset=available.find(item=>item.id===assetId)||historyItems.find(item=>item.assetId===assetId);
    $('#research-chart-title').textContent=asset?`${asset.symbol} · ${asset.name}`:'Asset price action';
    $('[data-tech-source]').textContent='Fetching provider candles…';
    try{
      let data=await request(`candles?asset=${encodeURIComponent(assetId)}&range=${selectedRange}`);
      if(sequence!==chartSequence)return;
      if(signedIn()){
        try{data=await request(`research/technicals?asset=${encodeURIComponent(assetId)}&range=${selectedRange}&horizon=${selectedHorizon}`,{headers:authOptions()})}
        catch(error){if(error.status!==403&&error.status!==401)throw error}
      }
      if(sequence!==chartSequence)return;
      await mountTechnicalChart($('#research-tech-chart'),data);
      if(data.indicators){updateTechnicalCards(data);root.querySelectorAll('[data-price-indicator]').forEach(input=>input.disabled=false);root.querySelectorAll('.research-tech-pane').forEach(pane=>pane.hidden=false)}
      else{$('#research-technical-cards').hidden=true;root.querySelectorAll('.research-tech-pane').forEach(pane=>pane.hidden=true)}
      $('[data-tech-source]').textContent=`${data.source} · ${data.candles.length} daily candles · latest ${localDate(data.candles.at(-1).time)} UTC`;
    }catch(error){if(sequence!==chartSequence)return;$('[data-tech-source]').textContent=error.message;setStatus(error.message,true)}
  };
  const selectAsset=async id=>{
    if(!id)return;
    let option=$(`#research-chat-asset option[value="${CSS.escape(id)}"]`);
    if(!option){const result=await request(`search?q=${encodeURIComponent(id)}`);const found=result.assets?.find(item=>item.id===id);if(!found)throw Error('Asset is not available in the search results.');$('#research-chat-asset').insertAdjacentHTML('beforeend',`<option value="${esc(found.id)}">${esc(found.symbol)} · ${esc(found.name)}</option>`)}
    $('#research-chat-asset').value=id;selectedAsset=id;$('#research-chat-search-results').replaceChildren();loadChart();
  };
  const loadConversation=async id=>{
    try{
      const result=await request(`research/conversations/${encodeURIComponent(id)}`,{headers:authOptions()});
      activeConversation=id;messages=result.messages.map(message=>({role:message.role,content:message.content,payload:message.payload,result:message.payload?.result}));
      const lastUser=[...result.messages].reverse().find(message=>message.role==='user');
      if(lastUser?.payload){selectedRange=lastUser.payload.chartRange||selectedRange;selectedHorizon=lastUser.payload.horizon||selectedHorizon;$('#research-chart-range').value=selectedRange;$('#research-horizon').value=selectedHorizon;await selectAsset(lastUser.payload.assetId||selectedAsset)}
      renderTranscript();$('#research-history-list').innerHTML=historyMarkup();setStatus('');
    }catch(error){setStatus(error.message,true)}
  };
  const newChat=()=>{activeConversation='';messages=[];renderTranscript();$('#research-history-list').innerHTML=historyMarkup();setStatus('');$('#research-chat-prompt').focus()};
  const sendMessage=async event=>{
    event.preventDefault();
    if(!signedIn()){openMembership();return}
    if(loading)return;
    const prompt=$('#research-chat-prompt').value.trim(),assetId=$('#research-chat-asset').value;
    if(!prompt||!assetId)return;
    loading=true;displayAccess();setStatus('Checking provider data and preparing your research…');
    messages.push({role:'user',content:prompt});renderTranscript();
    try{
      const response=await request('research/chat',{method:'POST',headers:{...authOptions(),'Content-Type':'application/json'},timeout:180000,body:JSON.stringify({conversationId:activeConversation||null,prompt,assetId,chartRange:selectedRange,horizon:selectedHorizon})});
      activeConversation=response.conversationId;
      messages.push({role:'assistant',content:response.answer,result:response.result});
      if(response.technical){updateTechnicalCards(response.technical);await mountTechnicalChart($('#research-tech-chart'),response.technical)}
      $('#research-chat-prompt').value='';setStatus('');await refreshHistory();
    }catch(error){
      messages.pop();setStatus(error.message,true);
      if(error.status===401||error.status===403)openMembership();
    }finally{loading=false;displayAccess();renderTranscript()}
  };
  const clickHandler=async event=>{
    const button=event.target.closest('button');if(!button||!root.contains(button))return;
    if(button.id==='research-chat-tab'){ $main.hidden=false;$studio.hidden=true;$('#research-chat-tab').classList.add('active');$('#research-studio-tab').classList.remove('active');$('#research-chat-tab').setAttribute('aria-selected','true');$('#research-studio-tab').setAttribute('aria-selected','false');return}
    if(button.id==='research-studio-tab'){$main.hidden=true;$studio.hidden=false;$('#research-chat-tab').classList.remove('active');$('#research-studio-tab').classList.add('active');$('#research-chat-tab').setAttribute('aria-selected','false');$('#research-studio-tab').setAttribute('aria-selected','true');if(!mountedStudio){mountedStudio=true;onResearch($('#research-studio'))}return}
    if(button.hasAttribute('data-research-unlock')){openMembership();return}
    if(button.id==='research-chat-find'){
      const query=$('#research-chat-search').value.trim();if(!query)return;
      button.disabled=true;$('#research-chat-search-results').textContent='Searching markets…';
      try{const result=await request(`search?q=${encodeURIComponent(query)}`);$('#research-chat-search-results').innerHTML=(result.assets||[]).slice(0,8).map(item=>`<button type="button" data-search-asset="${esc(item.id)}">${esc(item.symbol)} · ${esc(item.name)} <small>${esc(item.type)}</small></button>`).join('')||'<span class="muted small">No matching assets found.</span>'}
      catch(error){$('#research-chat-search-results').innerHTML=`<span class="notice">${esc(error.message)}</span>`}
      finally{button.disabled=false}return;
    }
    if(button.dataset.searchAsset){try{await selectAsset(button.dataset.searchAsset)}catch(error){setStatus(error.message,true)}return}
    if(button.id==='research-new-chat'){newChat();return}
    if(button.dataset.openConversation){await loadConversation(button.dataset.openConversation);return}
    if(button.dataset.deleteConversation){
      if(!confirm('Delete this saved research conversation?'))return;
      try{await request(`research/conversations/${encodeURIComponent(button.dataset.deleteConversation)}`,{method:'DELETE',headers:authOptions()});if(activeConversation===button.dataset.deleteConversation)newChat();await refreshHistory()}
      catch(error){setStatus(error.message,true)}return;
    }
  };
  const changeHandler=event=>{
    if(event.target.id==='research-chat-asset'||event.target.id==='research-chart-range'||event.target.id==='research-horizon')loadChart();
  };
  root.addEventListener('click',clickHandler);root.addEventListener('change',changeHandler);$('#research-chat-form').addEventListener('submit',sendMessage);$('#research-history-search').addEventListener('input',()=>$('#research-history-list').innerHTML=historyMarkup());
  const membershipHandler=()=>{displayAccess();refreshHistory();loadChart()};
  window.addEventListener('membershipchange',membershipHandler);
  rootCleanup=()=>{root.removeEventListener('click',clickHandler);root.removeEventListener('change',changeHandler);window.removeEventListener('membershipchange',membershipHandler);disposeTechnicalCharts(root)};
  displayAccess();renderTranscript();refreshHistory();loadChart();
}

import {request} from './platform.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function suggestMarket(markets,languages=navigator.languages,timezone=Intl.DateTimeFormat().resolvedOptions().timeZone){
 for(const language of languages||[]){try{const region=new Intl.Locale(language).region;const match=markets.find(m=>m.isoCountry===region);if(match)return match}catch{}}
 return markets.find(m=>m.timezone===timezone)||null;
}
export async function initializeMarketSelector(){
 const header=document.querySelector('.header-right');if(!header||document.querySelector('#market-selector-button'))return;
 let markets;try{markets=await request('markets/config')}catch{return}
 let stored='';try{stored=localStorage.getItem('sharebajar-market')||''}catch{}
 const pathCode=location.pathname.split('/')[2];let selected=markets.find(m=>m.marketCode===pathCode)||markets.find(m=>m.marketCode===stored)||null;
 const suggestion=suggestMarket(markets);
 const button=document.createElement('button');button.id='market-selector-button';button.type='button';button.setAttribute('aria-haspopup','dialog');header.prepend(button);
 const label=()=>button.textContent=(selected?selected.flag+' Market: '+selected.countryName:'🌐 Market: Global')+' ▾';label();
 const dialog=document.createElement('dialog');dialog.id='market-selector-dialog';dialog.setAttribute('aria-label','Choose a market');dialog.innerHTML='<div class="market-drawer-heading"><h2>Choose your market</h2><button type="button" id="market-selector-close" aria-label="Close market selector">✕</button></div><p class="muted">Explore any market. Your location is only a suggestion.</p><input id="market-selector-search" type="search" placeholder="Search a country or exchange" aria-label="Search markets"><button class="market-location-option" type="button" id="market-use-location">⌖ Use my location <small>Browser locale / time zone · no precise location requested</small></button><div id="market-selector-list"></div>';document.body.append(dialog);
 function choose(code){selected=markets.find(m=>m.marketCode===code)||null;try{localStorage.setItem('sharebajar-market',code||'global');localStorage.setItem('sharebajar-market-country',selected?.countryName||'')}catch{}label();dialog.close();location.assign(code?'/markets/'+code:'/markets')}
 function list(text=''){const q=text.toLowerCase();dialog.querySelector('#market-selector-list').innerHTML='<button class="market-choice" type="button" data-market-code=""><span>🌐 Global</span><small>All supported markets</small></button>'+markets.filter(m=>(m.countryName+' '+m.marketCode+' '+m.exchangeNames.join(' ')).toLowerCase().includes(q)).map(m=>'<button class="market-choice" type="button" data-market-code="'+esc(m.marketCode)+'"><span>'+m.flag+' '+esc(m.countryName)+(selected?.marketCode===m.marketCode?' ✓':'')+'</span><small>'+esc(m.exchangeNames.join(' / '))+' · '+m.currency+'</small></button>').join('')}
 button.onclick=()=>{list();dialog.showModal();dialog.querySelector('input').focus()};dialog.querySelector('#market-selector-close').onclick=()=>dialog.close();dialog.querySelector('input').oninput=e=>list(e.target.value);dialog.addEventListener('click',e=>{const choice=e.target.closest('[data-market-code]');if(choice)choose(choice.dataset.marketCode)});
 dialog.querySelector('#market-use-location').onclick=()=>{if(suggestion)choose(suggestion.marketCode);else{dialog.querySelector('p').textContent='No supported market could be inferred. Please choose any market below.'}};
 if(suggestion&&!stored&&!pathCode){const notice=document.createElement('div');notice.className='market-location-suggestion';notice.innerHTML='<span>Suggested for your browser: '+suggestion.flag+' '+esc(suggestion.countryName)+'</span><button type="button">Use this market</button><button type="button" aria-label="Dismiss market suggestion">✕</button>';document.querySelector('header').insertAdjacentElement('afterend',notice);notice.querySelector('button').onclick=()=>choose(suggestion.marketCode);notice.querySelectorAll('button')[1].onclick=()=>notice.remove()}
}

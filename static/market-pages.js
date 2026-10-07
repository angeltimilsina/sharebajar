import {initializeMarketSelector} from './market-selector.js';
import {initializeAI,openMembership} from './ai.js';
const open=dialog=>dialog.showModal();
initializeAI(open,message=>{const toast=document.querySelector('#toast');toast.textContent=message;toast.style.display='block';setTimeout(()=>toast.style.display='none',4000)}).catch(()=>{});
initializeMarketSelector();
document.addEventListener('click',e=>{const b=e.target.closest('button');if(b?.dataset.marketAuth)return openMembership(b.dataset.marketAuth);if(b?.id==='membership-button')return openMembership('login');if(b?.classList.contains('close'))b.closest('dialog').close()});
document.querySelector('#global-search').addEventListener('keydown',e=>{if(e.key==='Enter'){try{sessionStorage.setItem('sharebajar-market-search',e.target.value)}catch{}location.assign('/#search')}});

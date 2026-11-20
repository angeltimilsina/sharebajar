/** Applies the saved sidebar width before first paint (server-safe: no "use client"). */
export const SIDEBAR_KEY = "bajar.sidebar";
// Also hides the wallet side menu before first paint when a wallet was connected last time (it's restored right after).
export const SIDEBAR_SCRIPT = `(function(){var d=document.documentElement;try{d.dataset.sb=localStorage.getItem('${SIDEBAR_KEY}')==='collapsed'?'collapsed':'expanded';var l=JSON.parse(localStorage.getItem('sb.wallet.last')||'null');if(l&&l.ok&&l.address)d.dataset.sbHidden='1'}catch(e){d.dataset.sb='expanded'}})();`;

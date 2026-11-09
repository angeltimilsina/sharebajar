/** Applies the saved sidebar width before first paint (server-safe: no "use client"). */
export const SIDEBAR_KEY = "bajar.sidebar";
export const SIDEBAR_SCRIPT = `(function(){try{document.documentElement.dataset.sb=localStorage.getItem('${SIDEBAR_KEY}')==='collapsed'?'collapsed':'expanded'}catch(e){document.documentElement.dataset.sb='expanded'}})();`;

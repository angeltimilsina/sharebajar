import {portfolioMetrics} from './finance.js';

export function defaultMarket(state,assets) {
  const markets=[...new Set(assets.filter(a=>a.type==='Indexes'&&!['Europe','Global'].includes(a.country)).map(a=>a.country))].sort();
  if(!markets.length)markets.push(...new Set(assets.filter(a=>a.type==='Stocks'&&a.country!=='Provider directory').map(a=>a.country)));
  return {markets,selected:markets.includes(state.defaultMarket)?state.defaultMarket:markets.includes('United States')?'United States':markets[0]||'United States'};
}

export function dashboardMetrics(holdings,quotes,fx,base) {
  const result=portfolioMetrics(holdings,quotes,fx,base);
  const valued=result.rows.length-result.missing;
  return {...result,valued,value:valued?result.value:null,gain:valued?result.gain:null,daily:valued?result.daily:null};
}

export function newsLink(value) {
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';} catch {return '';}
}

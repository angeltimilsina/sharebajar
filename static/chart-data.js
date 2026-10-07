export function preparePriceHistory(history=[]) {
  const observations=new Map();
  for(const point of history || []) {
    if(!point || typeof point.time!=='number' || !Number.isFinite(point.time) || point.time<=0 ||
       typeof point.value!=='number' || !Number.isFinite(point.value)) continue;
    observations.set(Math.floor(point.time), {time:Math.floor(point.time),value:point.value});
  }
  return [...observations.values()].sort((a,b)=>a.time-b.time);
}

export function pricePrecision(prices) {
  const smallest=Math.min(...prices.filter(v=>Number.isFinite(v)&&v!==0).map(Math.abs));
  return smallest<1?Math.min(8,Math.max(2,Math.ceil(-Math.log10(smallest))+3)):2;
}

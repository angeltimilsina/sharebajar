// Match provider exchange metadata, never infer a listing from a ticker alone.
export const stockMarkets = [
  ['NASDAQ','United States','NASDAQ','NasdaqGS','NasdaqGM','NasdaqCM'],
  ['NYSE','United States','NYSE'],
  ['NSE','India','NSE'], ['BSE','India','BSE'],
  ['LSE','United Kingdom','LSE','London'], ['TSX','Canada','TSX','Toronto'],
  ['HKEX','Hong Kong','HKEX','HKSE'], ['Tokyo','Japan','Tokyo','JPX'],
  ['Shanghai','China','Shanghai'], ['Shenzhen','China','Shenzhen'],
  ['Xetra','Germany','Xetra'], ['Euronext Paris','France','Euronext Paris','Paris'],
  ['ASX','Australia','ASX'], ['SIX','Switzerland','SIX','Swiss'],
  ['NEPSE','Nepal','NEPSE']
].map(([id,country,...exchanges])=>({id,country,exchanges}));

export function inStockMarket(asset, marketId) {
  const market = stockMarkets.find(m=>m.id===marketId);
  return asset.type==='Stocks' && Boolean(market?.exchanges.some(e=>e.toLowerCase()===String(asset.exchange).toLowerCase()));
}

export function stockSearchQuery(ticker, marketId) {
  const suffixes = {NSE:'.NS',BSE:'.BO',LSE:'.L',TSX:'.TO',HKEX:'.HK',Tokyo:'.T',Shanghai:'.SS',Shenzhen:'.SZ',Xetra:'.DE','Euronext Paris':'.PA',ASX:'.AX',SIX:'.SW'};
  const value=ticker.trim();
  return /^[a-z0-9-]+$/i.test(value) && suffixes[marketId] ? value+suffixes[marketId] : value;
}

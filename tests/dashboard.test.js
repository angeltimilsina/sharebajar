import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultMarket,dashboardMetrics,newsLink} from '../static/dashboard.js';

test('saved default market survives catalog reload and unknown preferences fall back',()=>{
  const assets=[{type:'Indexes',country:'United States'},{type:'Indexes',country:'India'},{type:'Indexes',country:'Europe'}];
  assert.equal(defaultMarket({defaultMarket:'India'},assets).selected,'India');
  assert.equal(defaultMarket({defaultMarket:'Missing'},assets).selected,'United States');
  assert.deepEqual(defaultMarket({},assets).markets,['India','United States']);
});
test('a fully unavailable portfolio does not show a zero valuation',()=>{
  const holdings=[{asset:{id:'AAPL',type:'Stocks',currency:'USD'},quantity:2,price:100,currency:'USD'}];
  const result=dashboardMetrics(holdings,{AAPL:{error:'Unavailable'}},{rates:{USD:1}},'USD');
  assert.equal(result.value,null);assert.equal(result.daily,null);assert.equal(result.gain,null);assert.equal(result.missing,1);
});
test('headline links reject script, insecure and credential-bearing URLs',()=>{
  assert.equal(newsLink('javascript:alert(1)'), '');
  assert.equal(newsLink('http://example.com/news'),'');
  assert.equal(newsLink('https://user:secret@example.com/news'),'');
  assert.equal(newsLink('https://example.com/news'),'https://example.com/news');
});

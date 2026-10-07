import test from 'node:test';
import assert from 'node:assert/strict';
import { inStockMarket, stockSearchQuery } from '../static/stock-markets.js';

test('stock listings must match the chosen exchange, including provider aliases', () => {
  assert.equal(inStockMarket({type:'Stocks',exchange:'NasdaqGS'},'NASDAQ'),true);
  assert.equal(inStockMarket({type:'Stocks',exchange:'NYSE'},'NASDAQ'),false);
  assert.equal(inStockMarket({type:'ETFs',exchange:'NASDAQ'},'NASDAQ'),false);
  assert.equal(inStockMarket({type:'Stocks',exchange:'NASDAQ'},''),false);
  assert.equal(inStockMarket({type:'Stocks',exchange:''},'NYSE'),false);
});

test('ticker searches use the selected market suffix without doubling it', () => {
  assert.equal(stockSearchQuery(' RELIANCE ','NSE'),'RELIANCE.NS');
  assert.equal(stockSearchQuery('RELIANCE.NS','NSE'),'RELIANCE.NS');
  assert.equal(stockSearchQuery('AAPL','NASDAQ'),'AAPL');
  assert.equal(stockSearchQuery('Royal Bank','TSX'),'Royal Bank');
});

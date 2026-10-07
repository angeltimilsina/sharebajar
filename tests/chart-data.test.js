import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePriceHistory,pricePrecision} from '../static/chart-data.js';

test('chart history is sorted, unique and contains only valid observations',()=>{
  assert.deepEqual(preparePriceHistory([{time:3,value:11},{time:1,value:10},{time:3,value:12},
    {time:2,value:null},{time:4,value:Infinity},{time:0,value:9},{time:5,value:'14'},null]),
    [{time:1,value:10},{time:3,value:12}]);
});
test('tiny asset prices retain useful precision',()=>{
  assert.equal(pricePrecision([100,105]),2);
  assert.equal(pricePrecision([0.0000123]),8);
  assert.equal(pricePrecision([null,undefined,0]),2);
});

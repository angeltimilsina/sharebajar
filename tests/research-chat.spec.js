import {test,expect} from '@playwright/test';

const asset={id:'AAPL',symbol:'AAPL',name:'Apple',type:'Stocks',currency:'USD',country:'United States',exchange:'NASDAQ',region:'Americas'};
const candleData=Array.from({length:240},(_,index)=>{
  const close=100+index*.2+Math.sin(index/5)*2,time=Math.floor(Date.now()/1000)-(239-index)*86400;
  return {time,open:close-.3,high:close+1,low:close-1,close,volume:1000000};
});
const points=key=>candleData.slice(-80).map((candle,index)=>({time:candle.time,value:key==='rsi14'?50+Math.sin(index/7)*15:candle.close-(key==='macd'?100:0)}));
const technical={asset,candles:candleData.slice(-90),range:'3mo',source:'Fixture candles',sourceUrl:'https://example.com/AAPL',fetchedAt:new Date().toISOString(),
  indicators:{sma20:points('sma20'),sma50:points('sma50'),sma200:points('sma200'),ema20:points('ema20'),bollingerUpper:points('sma20'),bollingerLower:points('sma20'),rsi14:points('rsi14'),macd:points('macd'),macdSignal:points('macd'),macdHistogram:points('macd')},
  latestIndicators:{rsi14:56.4,sma20:147.2,sma50:145.3,macd:2.1},projection:{horizon:'1mo',available:true,historicalReturns:90,current:147,median:150,lower:132,upper:171,time:candleData.at(-1).time,futureTime:candleData.at(-1).time+30*86400}};
const report={summary:'Apple’s price trend is positive in this sample; the scenario range is uncertain.',sections:[{heading:'Technical context',body:'The RSI is moderate and the scenario band is not a price target.',evidence_ids:['TECH1']}],limitations:['Historical scenarios are not forecasts.'],research_questions:['Review the next earnings release.']};
async function setup(page,plan='pro'){
  const conversations=[];
  let messages=[];
  if(plan!=='free')await page.addInitScript(()=>sessionStorage.setItem('sharebajar-session','test-session'));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
    let body={};
    if(path==='/api/catalog')body={assets:[asset],regions:['World','Americas']};
    else if(path==='/api/account')body={signedIn:plan!=='free',plan,features:{assetAI:plan==='pro'},aiConfigured:true};
    else if(path==='/api/candles'||path==='/api/research/technicals')body=path.endsWith('/technicals')&&plan!=='pro'?{}:{...technical,indicators:path.endsWith('/technicals')?technical.indicators:undefined,latestIndicators:path.endsWith('/technicals')?technical.latestIndicators:undefined,projection:path.endsWith('/technicals')?technical.projection:undefined};
    else if(path==='/api/research/conversations')body={conversations,total:conversations.length};
    else if(path==='/api/research/conversations/chat-one')body={conversation:{id:'chat-one',title:'Explain the price trend'},messages};
    else if(path==='/api/search')body={assets:[asset]};
    else if(path==='/api/research/chat'){
      const request=route.request().postDataJSON();messages=[{role:'user',content:request.prompt,payload:{assetId:request.assetId,chartRange:request.chartRange,horizon:request.horizon}},{role:'assistant',content:report.summary,payload:{result:{interpretation:{report},technical}}}];
      if(!conversations.length)conversations.push({id:'chat-one',title:'Explain the price trend',created_at:Date.now()/1000,updated_at:Date.now()/1000});
      body={conversationId:'chat-one',answer:report.summary,result:{interpretation:{report,sources:[{id:'TECH1',title:'AAPL indicators',url:'https://example.com/AAPL'}]}},technical};
    }
    if(method==='DELETE'){conversations.splice(0,conversations.length);messages=[]}
    await route.fulfill({json:body});
  });
  await page.goto('/#analysis');
}
test('Pro asset research charts candles, explains scenarios, and saves account conversation history',async({page})=>{
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await setup(page);
  await expect(page.locator('[data-tech-price] canvas').first()).toBeVisible();
  await expect(page.locator('#research-technical-cards')).toContainText('147');
  await page.locator('#research-horizon').selectOption('3mo');
  await page.locator('#research-chat-prompt').fill('Explain Apple’s recent price action and the scenario range.');
  const response=page.waitForRequest(request=>request.url().endsWith('/api/research/chat'));
  await page.locator('#research-chat-send').click();
  const request=await response;
  expect(request.postDataJSON()).toMatchObject({assetId:'AAPL',horizon:'3mo',chartRange:'3mo'});
  expect(request.headers().authorization).toBe('Bearer test-session');
  await expect(page.locator('.research-assistant-message')).toContainText('Apple’s price trend');
  await expect(page.locator('#research-history-list')).toContainText('Explain the price trend');
  await page.locator('#research-studio-tab').click();
  await expect(page.locator('#research-run')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
test('Free visitors can inspect candles but cannot retrieve indicators or chat',async({page})=>{
  await setup(page,'free');
  await expect(page.locator('[data-tech-price] canvas').first()).toBeVisible();
  await expect(page.locator('#research-technical-access')).toContainText('Indicators, projections and AI chat are Pro tools');
  await expect(page.locator('#research-chat-send')).toBeDisabled();
  await expect(page.locator('.research-tech-pane').first()).toBeHidden();
  await page.locator('[data-research-unlock]').click();
  await expect(page.locator('#membership-dialog')).toBeVisible();
});

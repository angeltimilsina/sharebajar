import {test,expect} from '@playwright/test';
const asset={id:'^GSPC',symbol:'SPX',name:'S&P 500',country:'United States',region:'Americas',type:'Indexes',exchange:'S&P',currency:'USD'};
const articles=Array.from({length:5},(_,i)=>({title:'Market headline '+i,publisher:'Test publisher',url:'https://example.com/news/'+i,publishedAt:'2026-10-05T12:00:00Z'}));
async function setup(page,signedIn=false){
 let fullNewsCalls=0;
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let body={};
  if(url.pathname==='/api/account')body={signedIn,plan:'free',features:{}};
  if(url.pathname==='/api/catalog')body={assets:[asset],regions:['World','Americas']};
  if(url.pathname==='/api/quotes')body=[{id:asset.id,price:150,currency:'USD',previousClose:140,history:Array.from({length:30},(_,i)=>({time:1790856000+i*86400,value:130+i}))}];
  if(url.pathname==='/api/news/brief')body={status:'ready',summary:'Markets weigh earnings and the latest economic news.',articles:articles.slice(0,2),generatedAt:'2026-10-05T12:00:00Z'};
  if(url.pathname==='/api/news'){fullNewsCalls++;body={articles}};
  await route.fulfill({json:body});
 });
 await page.goto('/#charts');
 return ()=>fullNewsCalls;
}
test('guest chart and AI news preview share one view with sign-in to see more',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const calls=await setup(page);
 await expect(page.locator('#workspace-price-chart canvas').first()).toBeVisible();
 await expect(page.locator('#workspace-brief')).toContainText('Markets weigh earnings');
 await expect(page.locator('#workspace-brief .news-item')).toHaveCount(2);
 await page.locator('[data-workspace-range="1y"]').click();
 await expect(page.locator('[data-workspace-range="1y"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('[data-news-more]').click();
 await expect(page.locator('#membership-dialog')).toBeVisible();
 expect(calls()).toBe(0);
 expect(errors).toEqual([]);
 await page.locator('#membership-dialog .close').click();
 await page.screenshot({path:'test-results/liquid-glass-'+test.info().project.name+'.png',fullPage:true});
});
test('signed-in users can expand the full news feed',async({page})=>{
 const calls=await setup(page,true);
 await page.locator('[data-news-more]').click();
 await expect(page.locator('#workspace-more-news .news-item')).toHaveCount(5);
 expect(calls()).toBe(1);
});

for(const width of [320,360,430,768]){
 test('mobile layout fits '+width+'px with accessible controls and auth',async({page})=>{
  await page.setViewportSize({width,height:800});
  await setup(page);
  await expect(page.locator('#workspace-price-chart canvas').first()).toBeVisible();
  const fits=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
  expect(await fits()).toBe(true);
  for(const selector of ['#charts-instrument','#charts-news-market','[data-news-more]','#membership-button']){
   const rect=await page.locator(selector).boundingBox();
   expect(rect.height).toBeGreaterThanOrEqual(44);
   expect(rect.x).toBeGreaterThanOrEqual(0);
   expect(rect.x+rect.width).toBeLessThanOrEqual(width+1);
  }
  await page.locator('[data-news-more]').click();
  await expect(page.locator('#membership-dialog')).toBeVisible();
  expect(await page.locator('#membership-form input').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await page.locator('#membership-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.locator('#membership-dialog .close').click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.getByRole('heading',{name:'Charts, news & portfolio AI'})).toBeVisible();
  expect(await fits()).toBe(true);
 });
}

test('asset questions return an inline sourced AI review without leaving charts',async({page})=>{
 await setup(page,true);let submitted;
 await page.route('**/api/research/chat',async route=>{submitted=route.request().postDataJSON();await route.fulfill({json:{result:{interpretation:{generatedAt:'2026-10-05T12:00:00Z',report:{summary:'The observed trend is rising; headlines do not establish causality.',sections:[{heading:'Chart interpretation',body:'Review momentum and downside risks.',evidence_ids:['N1']}],limitations:['Headline metadata only.']},sources:[{id:'N1',title:'Sourced headline',url:'https://example.com/news'}]}}}})});
 await page.locator('[data-review-question]').first().click();
 await page.locator('#asset-review-submit').click();
 await expect(page.locator('#asset-review-answer')).toContainText('observed trend is rising');
 await expect(page.locator('#asset-review-answer a')).toHaveAttribute('href','https://example.com/news');
 expect(submitted.assetId).toBe(asset.id);expect(submitted.chartRange).toBe('1mo');
 await expect(page).toHaveURL(/#charts$/);
});
test('guests are asked to sign in before an AI review request is sent',async({page})=>{
 await setup(page);let calls=0;page.on('request',r=>{if(r.url().includes('/api/research/chat'))calls++});
 await page.locator('#asset-review-question').fill('Review this chart with the latest news');
 await page.locator('#asset-review-submit').click();
 await expect(page.locator('#membership-dialog')).toBeVisible();expect(calls).toBe(0);
});

test('stock market selection filters listings and scopes ticker searches',async({page})=>{
 await setup(page);
 const stocks=[{...asset,id:'AAPL',symbol:'AAPL',name:'Apple',type:'Stocks',exchange:'NasdaqGS'}, {...asset,id:'IBM',symbol:'IBM',name:'IBM',type:'Stocks',exchange:'NYSE'}, {...asset,id:'RELIANCE.NS',symbol:'RELIANCE.NS',name:'Reliance',type:'Stocks',exchange:'NSE',country:'India'}];
 await page.route('**/api/catalog',route=>route.fulfill({json:{assets:[asset,...stocks],regions:['World','Americas','Asia']}}));
 await page.reload();
 await page.locator('#explore-category').selectOption('Stocks');
 await expect(page.locator('#explore-stock-market')).toBeVisible();
 await page.locator('#explore-stock-market').selectOption('NASDAQ');
 await expect(page.locator('#charts-instrument option')).toHaveCount(1);
 await expect(page.locator('#charts-instrument')).toHaveValue('AAPL');
 await page.locator('#explore-stock-market').selectOption('NSE');
 await expect(page.locator('#charts-instrument')).toHaveValue('RELIANCE.NS');
 let query;
 await page.route('**/api/search?**',async route=>{query=new URL(route.request().url()).searchParams;await route.fulfill({json:{assets:stocks}})});
 await page.locator('#asset-review-query').fill('RELIANCE');
 await page.locator('#asset-review-search button').click();
 await expect(page.locator('#asset-review-search-status')).toContainText('matching listing');
 expect(query.get('q')).toBe('RELIANCE.NS');expect(query.get('type')).toBe('Stocks');
 await expect(page.locator('#charts-instrument option')).toHaveCount(1);
 await page.locator('#explore-category').selectOption('Indexes');
 await expect(page.locator('#explore-stock-market')).toBeHidden();
 await expect(page.locator('#charts-instrument')).toHaveValue(asset.id);
});

test('portfolio planning sends selected holdings and stated goals only',async({page})=>{
 await page.addInitScript(asset=>localStorage.setItem('sharebajar-v1',JSON.stringify({holdings:[{id:'h1',asset,quantity:2,price:100,currency:'USD',date:'2026-01-01',portfolio:'Main Portfolio',location:'private wallet'}],watchlist:[],portfolios:['Main Portfolio'],currency:'USD'})),asset);
 await setup(page,true);let body;
 await page.route('**/api/ai/plan',async route=>{body=route.request().postDataJSON();await route.fulfill({json:{report:{summary:'Review concentration against your home savings goal.',sections:[{heading:'Planning checklist',body:'Clarify liquidity needs and emergency savings.',evidence_ids:['P1']}],research_questions:['When do you need the funds?'],limitations:['Incomplete financial picture.']},sources:[],generatedAt:'2026-10-05T12:00:00Z'}})});
 const form=page.locator('#portfolio-plan-form');
 await form.locator('[name="goal"]').fill('Save for a home');
 await form.locator('[name="risk"]').selectOption('moderate');
 await form.locator('[name="monthlyContribution"]').fill('200');
 await form.locator('[name="liquidity"]').selectOption('later');
 await form.locator('button[type="submit"]').click();
 await expect(page.locator('#portfolio-plan-result')).toContainText('home savings goal');
 expect(body.profile.years).toBe(5);expect(body.profile.monthlyContribution).toBe(200);
 expect(body.holdings).toHaveLength(1);expect(body.holdings[0]).not.toHaveProperty('location');expect(body.holdings[0]).not.toHaveProperty('portfolio');
 await expect(page.locator('[data-plan-export]')).toBeVisible();
});

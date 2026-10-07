import {test,expect} from '@playwright/test';

const apple={id:'AAPL',symbol:'AAPL',name:'Apple',exchange:'NASDAQ',country:'United States',region:'Americas',type:'Stocks',currency:'USD'};
const indexes=[{id:'^GSPC',symbol:'^GSPC',name:'S&P 500',exchange:'S&P',country:'United States',region:'Americas',type:'Indexes',currency:'USD'},
  {id:'^NSEI',symbol:'^NSEI',name:'NIFTY 50',exchange:'NSE',country:'India',region:'Asia',type:'Indexes',currency:'INR'}];
test.beforeEach(async({page})=>{
  await page.addInitScript(({apple})=>!localStorage.getItem('sharebajar-v1')&&localStorage.setItem('sharebajar-v1',JSON.stringify({holdings:[{id:'h1',asset:apple,quantity:2,price:100,currency:'USD',portfolio:'Main Portfolio'}],watchlist:[apple],portfolios:['Main Portfolio'],currency:'USD'})),{apple});
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());let body={};if(url.pathname==='/api/account')body={signedIn:true,plan:'free',features:{}};
    if(url.pathname==='/api/catalog')body={assets:[apple,...indexes],regions:['World','Americas','Asia']};
    if(url.pathname==='/api/quotes')body=url.searchParams.get('symbols').split(',').map(id=>({id,price:150,change:1,changePercent:.67,currency:id==='^NSEI'?'INR':'USD',source:'Quote fixture',status:'Closed',history:[]}));
    if(url.pathname==='/api/news'){const market=url.searchParams.get('market');body={market,source:'Google News RSS',feedUrl:'https://news.google.com/rss/search?q=market',fetchedAt:'2026-10-04T18:05:00Z',articles:[{title:market+' markets update',publisher:'Publisher fixture',url:'https://example.com/article',publishedAt:'2026-10-04T18:00:00Z'}]};}
    await route.fulfill({json:body});
  });
});

test('overview leads with portfolio values and sourced market news',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Portfolio Overview'})).toBeVisible();
  const metrics=page.locator('#overview-valuation');
  await expect(metrics.locator('.overview-total strong')).toHaveText('$300.00');
  await expect(metrics.locator('.stat').nth(1).locator('strong')).toHaveText('$2.00');
  await expect(metrics.locator('.stat').nth(2).locator('strong')).toHaveText('$100.00');
  await expect(page.locator('#overview-news')).toContainText('Publisher fixture');
  await expect(page.getByRole('link',{name:'United States markets update'})).toHaveAttribute('href','https://example.com/article');
  await expect(page.locator('#overview-market-source')).toContainText('Quote fixture');
  await page.screenshot({path:`test-results/overview-${testInfo.project.name}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test('default market persists and changes indexes, news and explorer',async({page})=>{
  await page.goto('/');
  await page.getByLabel('Default market').selectOption('India');
  await expect(page.getByRole('heading',{name:'India news'})).toBeVisible();
  await expect(page.getByRole('link',{name:'India markets update'})).toBeVisible();
  await expect(page.locator('.overview-market')).toContainText('NIFTY 50');
  await page.reload();
  await expect(page.getByLabel('Default market')).toHaveValue('India');
  await page.locator('nav [data-view="markets"]').click();
  await expect(page.getByLabel('Filter country')).toHaveValue('India');
});

test('news failure and unavailable valuations remain explicit',async({page})=>{
  await page.route('**/api/news?**',route=>route.fulfill({status:503,json:{error:'News feed unavailable'}}));
  await page.route('**/api/quotes?**',route=>route.fulfill({json:[{id:'AAPL',error:'Quote unavailable'},{id:'^GSPC',error:'Quote unavailable'}]}));
  await page.goto('/');
  await expect(page.locator('#overview-news')).toContainText('Market news unavailable');
  await expect(page.locator('#overview-valuation')).toContainText('0 of 1 holdings valued');
  await expect(page.locator('.overview-total strong')).not.toContainText('$0');
  await expect(page.locator('#overview-valuation')).toContainText('Totals cover valued holdings only.');
});

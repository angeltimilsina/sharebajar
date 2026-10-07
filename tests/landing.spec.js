import {test,expect} from '@playwright/test';
const asset={id:'^GSPC',symbol:'SPX',name:'S&P 500',type:'Indexes',currency:'USD'};
const nepalAsset={id:'^NEPSE',symbol:'NEPSE',name:'Nepal Stock Exchange',type:'Indexes',currency:'NPR',country:'Nepal'};
test.beforeEach(async({page})=>{
 await page.route('**/api/**',route=>{
 const u=new URL(route.request().url());let body={signedIn:false,plan:'free',features:{}};
 if(u.pathname==='/api/catalog')body={assets:[asset,nepalAsset],regions:[]};
 if(u.pathname==='/api/news/categories')body={categories:[{id:'all',title:'Top stories'},{id:'technology',title:'Technology'},{id:'stocks',title:'Stocks'}],markets:['Global','India','Nepal','United States']};
 if(u.pathname==='/api/news/feed')body={categoryTitle:u.searchParams.get('category'),fetchedAt:new Date().toISOString(),articles:[{title:u.searchParams.get('category')+' latest headline '+u.searchParams.get('market'),url:'https://example.com/news',publisher:'News publisher',publishedAt:new Date().toISOString()}]};
 if(u.pathname==='/api/quotes')body=u.searchParams.get('symbols').split(',').map(id=>({id,price:150,changePercent:1.5,currency:id===nepalAsset.id?'NPR':'USD',source:'Test provider',updatedAt:1791201600,history:Array.from({length:30},(_,i)=>({time:1790856000+i*86400,value:130+i}))}));
 if(u.pathname==='/api/search')body={assets:[{...asset,id:'AAPL',symbol:'AAPL',type:'Stocks'}]};
 return route.fulfill({json:body});
 });
});
test('terminal shows news, categories, markets, search and account actions',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await expect(page.locator('#tm-news-list')).toContainText('all latest headline Global');
 await expect(page.locator('#tm-market-list')).toContainText('SPX');
 await expect(page.locator('#tm-price-chart canvas').first()).toBeVisible();
 await page.locator('[data-tm-category="technology"]').click();
 await expect(page.locator('#tm-news-list')).toContainText('technology latest headline Global');
 await page.locator('#tm-market').selectOption('India');
 await expect(page.locator('#tm-news-list')).toContainText('technology latest headline India');
 await expect(page.locator('#tm-news-list a')).toHaveAttribute('href','https://example.com/news');
 await page.locator('#tm-command-input').fill('Apple');await page.locator('#tm-command').evaluate(f=>f.requestSubmit());
 await expect(page.locator('#tm-chart-name')).toHaveText('AAPL');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:'test-results/terminal-'+testInfo.project.name+'.png',fullPage:true});
 await page.locator('.tm-account [data-view="signup"]').click();
 await expect(page.locator('#membership-form [name="confirmPassword"]')).toBeVisible();expect(errors).toEqual([]);
});
test('terminal fits a narrow phone',async({page})=>{
 await page.setViewportSize({width:320,height:740});await page.goto('/');
 await expect(page.locator('#tm-news-list')).toContainText('latest headline');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('guest home follows browser location and keeps stories and AI prompts simple',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'language',{get:()=> 'en-NP'}));
 await page.goto('/');
 expect(await page.evaluate(()=>navigator.language)).toBe('en-NP');
 await expect(page.locator('#tm-home-market')).toHaveText('Nepal');
 await expect(page.locator('#tm-chart-name')).toHaveText('NEPSE');
 await expect(page.locator('#tm-ticker')).toContainText('NEPSE');
 await expect(page.locator('#tm-news-list .tm-news-row')).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Log in to view more stories'})).toBeVisible();
 await expect(page.locator('.tm-feature-list li')).toHaveText(['AI analysis','Detailed fundamentals','Reports & analysis']);
 await expect(page.locator('.tm-research')).not.toContainText('Ask about a selected asset');
 await expect(page.getByRole('button',{name:'Open chart & AI review'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Add your portfolio'})).toBeVisible();
 await page.locator('#tm-command-input').fill('Apple');
 await page.locator('#tm-command').evaluate(f=>f.requestSubmit());
 await expect(page.locator('#tm-chart-name')).toHaveText('AAPL');
});

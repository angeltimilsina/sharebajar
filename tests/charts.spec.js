import {test,expect} from '@playwright/test';

const stocks=[{id:'AAPL',symbol:'AAPL',name:'Apple',exchange:'NASDAQ',country:'United States',region:'Americas',type:'Stocks',currency:'USD'},
  {id:'MSFT',symbol:'MSFT',name:'Microsoft',exchange:'NASDAQ',country:'United States',region:'Americas',type:'Stocks',currency:'USD'}];
const history=Array.from({length:180},(_,i)=>({time:1790856000+i*60,value:220+i*.025+Math.sin(i/10)*1.7}));
test.beforeEach(async({page})=>{
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    let body={};
    if(url.pathname==='/api/account')body={signedIn:true,plan:'free',features:{}};
    if(url.pathname==='/api/catalog')body={assets:stocks,regions:['World','Americas']};
    if(url.pathname==='/api/quotes')body=url.searchParams.get('symbols').split(',').map(id=>({id,price:225.73,previousClose:221.4,change:4.33,changePercent:1.956,status:'Closed',currency:'USD',source:'Test fixture',updatedAt:1790866740,history}));
    await route.fulfill({json:body});
  });
  await page.goto('/#markets');
  await page.getByRole('button',{name:'Stocks',exact:true}).click();
  await page.locator('.asset-link[data-asset="AAPL"]').click();
  await expect(page.locator('#detail-price-chart canvas').first()).toBeVisible();
  const bounds=await page.locator('#detail').boundingBox();
  expect(bounds.width).toBeGreaterThan(page.viewportSize().width*.98);
  expect(bounds.height).toBeGreaterThan(page.viewportSize().height*.98);
});

test('price scale, crosshair, chart styles, zoom and expand render correctly',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const panel=page.locator('#detail-price-chart');
  await expect(panel.locator('[data-chart-price]')).toContainText('USD');
  await expect(panel.locator('[data-chart-summary]')).toContainText('180 observations');
  await panel.getByRole('button',{name:'Line',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Line',exact:true})).toHaveAttribute('aria-pressed','true');
  await panel.getByRole('button',{name:'Zoom in',exact:true}).click();
  await panel.getByRole('button',{name:'Zoom out',exact:true}).click();
  await panel.getByRole('button',{name:'Reset view',exact:true}).click();
  const box=await panel.locator('[data-chart-canvas]').boundingBox();
  await page.mouse.move(box.x+box.width*.45,box.y+box.height*.5);
  await expect(panel.locator('[data-chart-time]')).not.toContainText('Last observation');
  await panel.getByRole('button',{name:'Area',exact:true}).click();
  await page.locator('[data-fullscreen]').click();
  await expect(page.locator('#detail')).toHaveClass(/chart-expanded/);
  const expanded=await page.locator('#detail').boundingBox();
  expect(expanded.width).toBeGreaterThan(page.viewportSize().width*.98);
  expect(expanded.height).toBeGreaterThan(page.viewportSize().height*.98);
  await expect(panel.locator('[data-chart-canvas]')).toBeVisible();
  await page.locator('[data-fullscreen]').click();
  await page.screenshot({path:`test-results/chart-${testInfo.project.name}.png`,fullPage:true});
  const overflow=await panel.evaluate(el=>el.scrollWidth>el.clientWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('range reload, dialog reopen and comparison dispose and recreate charts',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-range="1mo"]').click();
  await expect(page.locator('#detail-price-chart canvas').first()).toBeVisible();
  await page.locator('#detail .subwindow-bar .close').click();
  await page.locator('.asset-link[data-asset="MSFT"]').click();
  await expect(page.locator('#detail-price-chart .chart-symbol')).toHaveText('MSFT');
  await expect(page.locator('#detail-price-chart canvas').first()).toBeVisible();
  await page.locator('#detail .subwindow-bar .close').click();
  await page.locator('nav [data-view="analysis"]').click();
  await expect(page.getByRole('heading',{name:'Analysis',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Research studio'}).click();
  await expect(page.locator('#research-a')).toBeVisible();
  await expect(page.locator('nav [data-view="compare"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('missing historical prices display an unavailable chart',async({page})=>{
  await page.route('**/api/quotes?**',route=>route.fulfill({json:[{id:'AAPL',price:225.73,currency:'USD',history:[]}]}));
  await page.locator('[data-range="1y"]').click();
  await expect(page.locator('#detail-price-chart')).toContainText('Historical chart unavailable from provider.');
  await expect(page.locator('#detail-price-chart button').first()).toBeDisabled();
});

test('full-screen views keep Back accessible and restore the workspace',async({page})=>{
  await expect(page.locator('body')).toHaveClass(/subwindow-open/);
  await page.locator('#detail').evaluate(el=>el.scrollTop=el.scrollHeight);
  await expect(page.locator('#detail .subwindow-bar .close')).toBeInViewport();
  await page.locator('#detail .subwindow-bar .close').click();
  await expect(page.locator('#detail')).not.toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/subwindow-open/);
  await page.locator('.asset-link[data-asset="AAPL"]').click();
  await page.locator('#detail [data-holding]').click();
  const holding=page.locator('#holding-dialog');
  await expect(holding).toBeVisible();
  const bounds=await holding.boundingBox();
  expect(bounds.width).toBeGreaterThan(page.viewportSize().width*.98);
  expect(bounds.height).toBeGreaterThan(page.viewportSize().height*.98);
  await expect(page.locator('body')).toHaveClass(/subwindow-open/);
  await page.keyboard.press('Escape');
  await expect(holding).not.toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/subwindow-open/);
});

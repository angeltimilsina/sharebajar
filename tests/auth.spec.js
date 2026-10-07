import {test,expect} from '@playwright/test';

test('membership offers separate sign-in, signup, Google setup, and reset paths',async({page})=>{
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const body=path==='/api/catalog'?{assets:[],regions:[]}:path==='/api/account'?{signedIn:false,plan:'free',features:{},googleConfigured:false,passwordResetConfigured:false}:{};
  await route.fulfill({json:body});
 });
 await page.goto('/#overview');
 await page.locator('#membership-button').click();
 await expect(page.locator('#membership-dialog')).toBeVisible();
 await expect(page.locator('[data-google-login]')).toBeDisabled();
 await page.locator('[data-auth-mode="signup"]').click();
 await expect(page.locator('#membership-form [name="confirmPassword"]')).toBeVisible();
 await page.locator('[data-auth-mode="login"]').click();
 await page.locator('[data-password-reset]').click();
 await expect(page.locator('#reset-request-form')).toBeVisible();
 await page.locator('#reset-request-form [name="email"]').fill('member@example.test');
 await page.locator('#reset-request-form button[type="submit"]').click();
 await expect(page.locator('#membership-status')).toContainText('If that email belongs to an active account');
});

test('a reset link opens the new-password form and clears its token after use',async({page})=>{
 let resetBody;
 const token='one-time-reset-token-value-with-at-least-thirty-two-chars';
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let body={};
  if(path==='/api/account')body={signedIn:false,plan:'free',features:{}};
  if(path==='/api/catalog')body={assets:[],regions:[]};
  if(path==='/api/auth/password-reset'){resetBody=route.request().postDataJSON();body={reset:true}}
  await route.fulfill({json:body});
 });
 await page.goto('/#reset='+token);
 await expect(page.locator('#reset-password-form')).toBeVisible();
 await page.locator('#reset-password-form [name="password"]').fill('a-new-long-password');
 await page.locator('#reset-password-form [name="confirmPassword"]').fill('a-new-long-password');
 await page.locator('#reset-password-form button[type="submit"]').click();
 await expect(page.locator('#membership-status')).toContainText('Password updated');
 await expect.poll(()=>resetBody?.token).toBe(token);
 await expect(page).toHaveURL(/#charts$/);
});

test('administrator navigation and user details are populated from protected API data',async({page})=>{
 let saved;
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  let body={};
  if(path==='/api/account')body={signedIn:true,email:'admin@example.test',plan:'free',isAdmin:true,features:{}};
  if(path==='/api/catalog')body={assets:[],regions:[]};
  if(path==='/api/admin/users')body={total:1,users:[{id:'user-1',email:'member@example.test',auth_provider:'google,password',role:'user',plan:'free',plan_expires:1793829532,disabled:0,created_at:1791221932,last_seen_at:null}]};
  if(path==='/api/admin/users/manage'){saved=route.request().postDataJSON();body={updated:true}}
  await route.fulfill({json:body});
 });
 await page.goto('/#admin');
 await expect(page.locator('#nav [data-view="admin"]')).toBeVisible();
 await expect(page.locator('#admin-users')).toContainText('member@example.test');
 await expect(page.locator('#admin-users')).toContainText('google + password');
 await expect(page.locator('#admin-users')).not.toContainText('password hash');
 await page.locator('#admin-users [data-plan]').selectOption('pro');
 await page.locator('#admin-users [data-action="plan"]').click();
 await expect.poll(()=>saved?.plan).toBe('pro');
 await expect.poll(()=>saved?.userId).toBe('user-1');
});


test('guests see only markets and charts and protected links fall back to markets',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/catalog'?{assets:[],regions:[]}:{signedIn:false,plan:'free',features:{},googleConfigured:true}}));
 await page.goto('/#portfolio');
 await expect(page).toHaveURL(/#charts$/);
 await expect(page.locator('#nav button')).toHaveCount(0);
 await expect(page.locator('.sidebar')).toBeHidden();
 await expect(page.locator('#currency-button')).toBeHidden();
 await expect(page.getByRole('heading',{name:'Charts, news & portfolio AI'})).toBeVisible();
 await page.evaluate(()=>location.hash='analysis');
 await expect(page).toHaveURL(/#charts$/);
 await page.locator('#membership-button').click();
 await expect(page.locator('[data-google-login]')).toBeEnabled();
 expect(errors).toEqual([]);
});

test('signup restores private navigation and logout removes it immediately',async({page})=>{
 let signedIn=false,credentials;
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let body={};
  if(path==='/api/catalog')body={assets:[],regions:[]};
  if(path==='/api/auth/signup'){credentials=route.request().postDataJSON();signedIn=true;body={token:'test-session'}};
  if(path==='/api/auth/logout')signedIn=false;
  if(path==='/api/account')body={signedIn,plan:'free',email:signedIn?'member@example.test':null,features:{}};
  await route.fulfill({json:body});
 });
 await page.goto('/#signup');
 await expect(page.locator('#membership-form [name="confirmPassword"]')).toBeVisible();
 await page.locator('#membership-form [name="email"]').fill('member@example.test');
 await page.locator('#membership-form [name="password"]').fill('a-long-test-password');
 await page.locator('#membership-form [name="confirmPassword"]').fill('a-long-test-password');
 await page.locator('#membership-form button[type="submit"]').click();
 await expect(page.locator('#sign-out')).toBeVisible();
 expect(credentials).toEqual({email:'member@example.test',password:'a-long-test-password'});
 await expect(page.locator('#nav [data-view="portfolio"]')).toBeVisible();
 await page.locator('#membership-dialog .close').click();
 await page.locator('#nav [data-view="portfolio"]').click();
 await page.locator('#membership-button').click();
 await page.locator('#sign-out').click();
 await expect(page).toHaveURL(/#charts$/);
 await expect(page.locator('#nav button')).toHaveCount(0);
 await expect(page.locator('.sidebar')).toBeHidden();
 expect(await page.evaluate(()=>sessionStorage.getItem('sharebajar-session'))).toBeNull();
});

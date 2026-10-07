import json,os,re,tempfile,time,threading,unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from xml.etree import ElementTree
import financial_engine as engine
import financial_content as content
import financial_pages as pages
import growth_workspace as growth
import membership as members
import server

class FinancialEngineTests(unittest.TestCase):
    def test_every_template_has_coherent_financial_contract(self):
        for template in engine.list_templates():
            page=engine.generate_page({'template':template['id'],'marketCode':'us'})
            json.dumps(page,allow_nan=False)
            for field in ['hero','rankingTable','marketCards','assetCards','researchSummary','relatedLinks','jsonLd','canonicalUrl','cta','mobileLayout','appScreen']:
                self.assertIn(field,page)
            self.assertEqual(page['designSystem'],'sharebajar-v1');self.assertTrue(page['isMock'])
            self.assertEqual(page['visibility'],template['visibility'])
    def test_valuation_filters_match_fundamentals_without_crypto_multiples(self):
        for code in engine.BY_CODE:
            for category in ['undervalued','fair','overvalued']:
                rows=engine.valuation_assets(code,valuation=category)
                self.assertTrue(all(a['valuationCategory']==category for a in rows))
            self.assertTrue(all(a['dividendYield']>=3 for a in engine.valuation_assets(code,valuation='dividend')))
        crypto=engine.valuation_assets('crypto')
        self.assertTrue(crypto);self.assertTrue(all(a['pe'] is None and a['pb'] is None and a['valuationScore'] is None for a in crypto))
    def test_generation_rejects_bad_inputs(self):
        for payload in [{'template':'website'},{'marketCode':'invalid'},{'path':'//evil.example'},{'path':'/../evil'},{'symbols':['UNKNOWN']},{'symbols':['AAPL','AAPL']},{'trendInputs':{'unknown':'signal'}},{'trendInputs':{'searchVolume':float('nan')}},{'range':'bad'},{'valuation':'bad'}]:
            with self.subTest(payload=payload),self.assertRaises(ValueError):engine.generate_page(payload)
    def test_supplied_trend_signals_are_labelled_unverified(self):
        p=engine.generate_page({'template':'trend','trendInputs':{'searchVolume':100,'newsCatalysts':['earnings'],'countryInterest':{'Nepal':10}}})
        self.assertTrue(any(d.get('source','').startswith('User-supplied') for d in p['researchSummary']['drivers']))
    def test_curated_public_pages_render_with_seo_and_asset_links(self):
        for path in pages.public_paths():
            with self.subTest(path=path):
                body=pages.render(path);self.assertIsNotNone(body);self.assertIn('rel="canonical"',body);self.assertIn('<h1>',body)
        for path,payload in engine.generated_page_paths().items():
            if path.startswith(('/workspace','/asset','/app')):continue
            body=pages.render(path);self.assertIn('application/ld+json',body);self.assertIn('/asset/',body)
    def test_home_market_matches_query_and_has_valid_ranking_links(self):
        import market_pages
        for query,country in [('', 'Global markets'),('market=nepal','Nepal'),('market=us','United States')]:
            body=pages.home(query);self.assertIn('<h3>'+country+'</h3>',body)
            for url in re.findall('href="([^"]+)"',body):
                if url.startswith(('/markets','/asset')):self.assertIsNotNone(market_pages.parse_route(url.split('?')[0]),url)
    def test_structured_data_cannot_close_script(self):
        from product_shell import render_shell
        body=render_shell('','Title','Desc','/',{'name':'</script><script>evil()</script>'})
        self.assertNotIn('</script><script>evil()',body);self.assertIn('\\u003c',body)

class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'SHAREBAJAR_ACCOUNT_DB':self.temp.name+'/accounts.sqlite','SHAREBAJAR_PUBLIC_URL':'https://sharebajar.example'});self.env.start()
        self.a=self.user('a@example.test','pro');self.b=self.user('b@example.test','plus');self.free=self.user('free@example.test','free')
    def tearDown(self):self.env.stop();self.temp.cleanup()
    def user(self,email,plan):
        auth=members.signup({'email':email,'password':'a-long-test-password'});user=members.authenticated_user('Bearer '+auth['token'])
        with members.database() as db:db.execute('UPDATE users SET plan=?,plan_expires=? WHERE id=?',(plan,time.time()+86400,user['id']))
        return members.authenticated_user('Bearer '+auth['token'])
    def test_anonymous_and_free_membership_boundaries(self):
        with self.assertRaises(members.AppError) as c:growth.get_state(None)
        self.assertEqual(c.exception.status,401)
        result=growth.mutate(self.free,{'action':'watch_add','marketCode':'us','symbol':'AAPL'})
        self.assertEqual(len(result['state']['watchlist']),1)
        with self.assertRaises(members.AppError) as c:growth.mutate(self.free,{'action':'demo_sync'})
        self.assertEqual(c.exception.status,403)
    def test_account_isolation_and_cross_currency_risk(self):
        result=growth.mutate(self.a,{'action':'portfolio_import','name':'Mixed','csv':'marketCode,symbol,quantity,costBasis\nus,AAPL,10,180\nnepal,NABIL,20,500'})
        p=result['state']['portfolios'][0];self.assertEqual(set(p['totalsByCurrency']),{'USD','NPR'});self.assertEqual(len(p['risk']['byCurrency']),2)
        self.assertEqual(growth.get_state(self.b)['portfolios'],[])
        with self.assertRaises(members.AppError) as c:growth.mutate(self.b,{'action':'portfolio_remove','id':p['id']})
        self.assertEqual(c.exception.status,404)
    def test_bad_csv_and_nonfinite_holdings_are_rejected(self):
        for payload in [{'csv':'symbol,quantity\nAAPL,10'},{'holdings':[{'marketCode':'us','symbol':'AAPL','quantity':'nan'}]},{'holdings':[{'marketCode':'us','symbol':'AAPL','quantity':-1}]},{'holdings':[{'marketCode':'us','symbol':'AAPL','quantity':1},{'marketCode':'us','symbol':'AAPL','quantity':2}]}]:
            with self.subTest(payload=payload),self.assertRaises(members.AppError):growth.mutate(self.a,dict(action='portfolio_import',**payload))
    def test_reports_export_and_forecast_plan_rules(self):
        state=growth.mutate(self.a,{'action':'demo_sync'})['state'];p=state['portfolios'][0]
        self.assertEqual([s['changePercent'] for s in state['scenarios'][0]['byCurrency'][0]['scenarios']],[-20,5,20])
        report=growth.mutate(self.a,{'action':'report_generate','template':'portfolio-risk','portfolioId':p['id'],'prompt':'Review risk'})['state']['reports'][0]
        exported=growth.export_report(self.a,report['id']);self.assertIn('illustrative mock',exported['content'])
        with self.assertRaises(members.AppError) as c:growth.export_report(self.b,report['id'])
        self.assertEqual(c.exception.status,403)
        with self.assertRaises(members.AppError):growth.mutate(self.b,{'action':'report_generate','template':'scenario-forecast'})
    def test_alerts_and_preferences_stay_in_owner_account(self):
        growth.mutate(self.a,{'action':'alert_create','marketCode':'us','symbol':'AAPL','direction':'above','threshold':1})
        self.assertEqual(growth.get_state(self.b)['alerts'],[])
        p=growth.mutate(self.a,{'action':'profile_update','marketCode':'nepal','riskProfile':'balanced','horizon':'long-term'})['state']['preferences']
        self.assertEqual(p['marketCode'],'nepal')
    def test_drafts_require_admin_and_private_pages_cannot_publish(self):
        with self.assertRaises(members.AppError):content.create_draft(self.a,engine.generate_page({}))
        admin=dict(self.a,role='admin');other=dict(self.b,role='admin')
        draft=content.create_draft(admin,engine.generate_page({'template':'portfolio-research'}))
        with self.assertRaises(members.AppError):content.publish(admin,draft['id'])
        with self.assertRaises(members.AppError):content.publish(other,draft['id'])
        public=content.create_draft(admin,engine.generate_page({'template':'trend'}));published=content.publish(admin,public['id'])
        body=pages.render(published['path']);self.assertIn('href="https://sharebajar.example'+published['path']+'"',body)
        self.assertEqual(len(content.list_drafts(other)),0)

class FinancialHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler);cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start();cls.base='http://127.0.0.1:'+str(cls.http.server_port)
    @classmethod
    def tearDownClass(cls):cls.http.shutdown();cls.http.server_close();cls.thread.join()
    def call(self,path,body=None):
        req=Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
        try:
            with urlopen(req) as r:return r.status,r.read().decode()
        except HTTPError as e:return e.code,e.read().decode()
    def test_public_routes_and_private_api_guards(self):
        for path in ['/','/research','/pricing','/markets/us/valuation','/asset/nepal/NABIL','/app/portfolio','/workspace','/internal/page-generator']:
            status,body=self.call(path);self.assertEqual(status,200,path);self.assertIn('<h1>',body)
        for path in ['/api/growth/state','/api/growth/export?id=x','/api/financial/drafts']:
            self.assertEqual(self.call(path)[0],401,path)
        self.assertEqual(self.call('/api/financial/generate',{})[0],401)
        self.assertEqual(self.call('/api/financial/publish',{'id':'x'})[0],401)
    def test_home_cookie_keeps_the_selected_market(self):
        req=Request(self.base+'/',headers={'Cookie':'sharebajar-market=nepal'})
        with urlopen(req) as r:body=r.read().decode()
        self.assertIn('<h3>Nepal</h3>',body);self.assertIn('href="/markets/nepal/valuation"',body)
    def test_valuation_and_screen_contracts(self):
        status,body=self.call('/api/financial/valuation?market=india&valuation=undervalued');data=json.loads(body);self.assertEqual(status,200);self.assertTrue(all(a['marketCode']=='india' and a['valuationCategory']=='undervalued' for a in data['assets']))
        status,body=self.call('/api/financial/screens?market=nepal');self.assertEqual(status,200);self.assertEqual(len(json.loads(body)['screens']),15)
        self.assertEqual(self.call('/api/financial/valuation?market=bad')[0],400)
        self.assertEqual(self.call('/api/financial/page?path=/workspace/risk')[0],403)
    def test_static_research_modules_are_not_confused_with_page_routes(self):
        for path in ['/app.js','/research-workspace.js','/research-chat.js','/financial-pages.js','/shared/financial-api.js']:
            status,body=self.call(path);self.assertEqual(status,200,path);self.assertNotIn('<h1>Research page not found',body)
    def test_private_routes_are_not_indexed(self):
        for path in ['/workspace/portfolio','/internal/page-generator']:
            self.assertIn('noindex,nofollow',self.call(path)[1])
        status,body=self.call('/sitemap.xml');self.assertEqual(status,200)
        self.assertNotIn('/workspace',body);self.assertNotIn('/internal/',body);self.assertIn('/markets/nepal/valuation',body)
if __name__=='__main__':unittest.main()

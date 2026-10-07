import io,json,os,tempfile,threading,unittest
from unittest.mock import patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
import membership as m
import ai_analysis as ai
from server import Handler

class AIIntegration(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'SHAREBAJAR_ACCOUNT_DB':self.temp.name+'/accounts.sqlite','OPENAI_API_KEY':'test-server-key'});self.env.start()
    def tearDown(self):self.env.stop();self.temp.cleanup()
    def test_plans_sessions_and_client_plan_cannot_unlock(self):
        auth=m.signup({'email':'test@example.com','password':'long-test-password','plan':'pro'})
        user=m.authenticated_user('Bearer '+auth['token']);self.assertEqual(m.effective_plan(user),'free')
        with self.assertRaises(m.AppError):m.require_plan(user,'plus')
        m.set_plan('test@example.com','plus',1);user=m.authenticated_user('Bearer '+auth['token']);m.require_plan(user,'plus')
        with self.assertRaises(m.AppError):m.require_plan(user,'pro')
        with patch('membership.time.time',return_value=user['plan_expires']+1):self.assertEqual(m.effective_plan(user),'free')
        m.logout('Bearer '+auth['token'])
        with self.assertRaises(m.AppError):m.authenticated_user('Bearer '+auth['token'])
    def test_planning_uses_explicit_preferences_and_rejects_invalid_profile(self):
        body={'currency':'USD','holdings':[], 'profile':{'goal':'Save for a home','risk':'moderate','years':5,'monthlyContribution':200,'liquidity':'later'}}
        with patch('ai_analysis.portfolio_context',return_value={'kind':'portfolio','evidence':[],'dataLimitations':[]}):
            context=ai.planning_context(body)
        self.assertEqual(context['kind'],'planning')
        self.assertEqual(context['evidence'][0]['data']['risk'],'moderate')
        body['profile']['years']=True
        with patch('ai_analysis.portfolio_context') as provider:
            with self.assertRaises(m.AppError):ai.planning_context(body)
            provider.assert_not_called()

    def test_rate_limit(self):
        m.reserve_usage('x',1)
        with self.assertRaises(m.AppError):m.reserve_usage('x',1)
    def test_cash_and_private_field_validation(self):
        body={'holdings':[{'id':'cash:USD','currency':'USD','quantity':10,'price':1,'location':'private wallet','portfolio':'private name'}]}
        holdings,base=ai.validate_holdings(body);self.assertNotIn('location',holdings[0]);self.assertNotIn('portfolio',holdings[0])
        body['holdings'][0]['id']='cash:AAPL'
        with self.assertRaises(m.AppError):ai.validate_holdings(body)
        body['holdings'][0]['id']='cash:USD';body['holdings'][0]['quantity']=float('nan')
        with self.assertRaises(m.AppError):ai.validate_holdings(body)
    def test_responses_contract_and_reject_incomplete_or_unknown_citations(self):
        report={'summary':'Summary','sections':[{'heading':'Exposure','body':'Observed fact','evidence_ids':['P1']}],'limitations':[],'research_questions':['Check concentration?']}
        context={'kind':'portfolio','evidence':[ai.evidence_item('P1','Positions',[])],'dataLimitations':['Limited history']}
        def response(status='completed',r=report):return io.BytesIO(json.dumps({'status':status,'output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(r)}]}]}).encode())
        with patch('ai_analysis.urlopen',return_value=response()) as call:
            result=ai.generate_report(context);request=call.call_args.args[0];payload=json.loads(request.data)
            self.assertFalse(payload['store']);self.assertTrue(payload['text']['format']['strict']);self.assertEqual(request.get_header('Authorization'),'Bearer test-server-key');self.assertIn('Limited history',result['report']['limitations']);self.assertNotIn('data',result['sources'][0])
        with patch('ai_analysis.urlopen',return_value=response('incomplete')):
            with self.assertRaises(m.AppError):ai.generate_report(context)
        report['sections'][0]['evidence_ids']=['FAKE']
        with patch('ai_analysis.urlopen',return_value=response()):
            with self.assertRaises(m.AppError):ai.generate_report(context)
    def test_http_gating_before_model_and_mobile_preflight(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        origin='http://127.0.0.1:'+str(server.server_port)
        def post(path,body,token=None):
            headers={'Content-Type':'application/json'}
            if token:headers['Authorization']='Bearer '+token
            return urlopen(Request(origin+path,data=json.dumps(body).encode(),headers=headers),timeout=5)
        try:
            with patch('server.generate_report') as generate:
                with self.assertRaises(HTTPError) as e:post('/api/ai/asset',{'id':'AAPL','plan':'pro'})
                self.assertEqual(e.exception.code,401)
                with post('/api/auth/signup',{'email':'http@example.com','password':'long-test-password','plan':'pro'}) as r:auth=json.load(r)
                with self.assertRaises(HTTPError) as e:post('/api/ai/asset',{'id':'AAPL','plan':'pro'},auth['token'])
                self.assertEqual(e.exception.code,403);generate.assert_not_called()
                m.set_plan('http@example.com','pro',1)
                with patch('server.asset_context',return_value={'kind':'asset'}),patch('server.generate_report',return_value={'report':{'summary':'ok'}}):
                    with post('/api/ai/asset',{'id':'AAPL'},auth['token']) as r:self.assertEqual(r.status,200)
            with urlopen(Request(origin+'/api/ai/asset',method='OPTIONS',headers={'Origin':'capacitor://localhost'})) as r:self.assertEqual(r.headers['Access-Control-Allow-Origin'],'capacitor://localhost')
        finally:server.shutdown();server.server_close();thread.join()

    def test_portfolio_totals_use_provider_prices_and_fx(self):
        asset={'id':'AAPL','symbol':'AAPL','name':'Apple','type':'Stocks','currency':'EUR','country':'United States'}
        body={'currency':'USD','holdings':[{'id':'AAPL','currency':'EUR','quantity':2,'price':80},{'id':'cash:USD','currency':'USD','quantity':10,'price':1}]}
        with patch('ai_analysis.resolve_asset',return_value=asset),patch('ai_analysis.quote_snapshot',return_value={'price':100,'currency':'EUR','change':2}),patch('ai_analysis.request_json',return_value={'rates':{'EUR':.5}}),patch('ai_analysis.market_news',return_value={'articles':[]}):
            context=ai.portfolio_context(body)
        totals=next(e['data'] for e in context['evidence'] if e['id']=='P2')
        self.assertEqual(totals['value'],410);self.assertEqual(totals['cost'],330);self.assertEqual(totals['daily'],8)
    def test_fundamentals_drop_invalid_metrics_and_require_matching_listing(self):
        from fundamentals import normalize_fundamentals
        from providers import DataUnavailable
        data={'Symbol':'AAPL','PERatio':'25.5','EPS':'None','Beta':'NaN','LatestQuarter':'2026-06-30'}
        result=normalize_fundamentals(data,'AAPL');self.assertEqual(result['metrics'],{'PERatio':25.5})
        with self.assertRaises(DataUnavailable):normalize_fundamentals(data,'MSFT')

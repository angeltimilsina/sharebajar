import io,json,os,tempfile,threading,unittest
from datetime import date,timedelta
from unittest.mock import patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
import research as r
import membership as m
from server import Handler

APPLE={'id':'AAPL','symbol':'AAPL','name':'Apple','type':'Stocks','country':'United States','currency':'USD','exchange':'NASDAQ'}
MICROSOFT=APPLE|{'id':'MSFT','symbol':'MSFT','name':'Microsoft'}
BENCH=APPLE|{'id':'^GSPC','symbol':'^GSPC','name':'S&P 500','type':'Indexes'}
def points(start,count=100):return [{'time':r.stamp(start+timedelta(days=i)),'value':100+i} for i in range(count)]

class Research(unittest.TestCase):
    def test_last_completed_quarter_across_year_and_leap_boundaries(self):
        self.assertEqual(r.window_dates('quarter',date(2026,10,4)),(date(2026,7,1),date(2026,9,30)))
        self.assertEqual(r.window_dates('quarter',date(2026,1,1)),(date(2025,10,1),date(2025,12,31)))
        self.assertEqual(r.window_dates('quarter',date(2024,4,1)),(date(2024,1,1),date(2024,3,31)))
        with self.assertRaises(m.AppError):r.window_dates('live')
    def test_return_uses_preceding_close_and_discloses_missing_coverage(self):
        start,end=date(2026,7,1),date(2026,9,30);p=points(date(2026,6,30),93)
        result=r.price_metrics(p,start,end,True);self.assertEqual(result['baselineDate'],'2026-06-30');self.assertAlmostEqual(result['priceReturn'],92);self.assertIsNotNone(result['volatility'])
        self.assertIsNone(r.price_metrics(p[1:],start,end,True)['priceReturn'])
        self.assertIsNone(r.price_metrics(p[:-15],start,end,True)['priceReturn'])
        self.assertIsNone(r.price_metrics(p[::2],start,end,True)['volatility'])
    def test_historical_yahoo_request_has_exact_dates_and_keeps_volume(self):
        start,end=date(2026,7,1),date(2026,9,30);p=points(date(2026,6,30),93)
        raw={'chart':{'result':[{'meta':{'currency':'USD'},'timestamp':[i['time'] for i in p],'indicators':{'quote':[{'close':[i['value'] for i in p],'volume':[1000]*len(p)}]}}]}}
        with patch('research.request_json',return_value=raw) as call:
            data=r.history(APPLE,start,end)
        self.assertIn('period1=',call.call_args.args[0]);self.assertIn('period2=',call.call_args.args[0]);self.assertEqual(data['volume'],1000);self.assertEqual(data['dataAsOf'],'2026-09-30')
        with patch('research.request_json',return_value=raw):self.assertIsNone(r.history(BENCH,start,end)['volume'])
    def test_type_appropriate_benchmarks_and_fundamentals(self):
        self.assertIsNone(r.default_benchmark(APPLE|{'type':'Forex'}));self.assertEqual(r.default_benchmark(APPLE|{'type':'Crypto'}),'crypto:bitcoin')
        with patch('research.history',side_effect=r.DataUnavailable('No history')),patch('research.company_fundamentals') as fundamentals:
            result=r.asset_result(APPLE|{'type':'Crypto'},date(2026,7,1),date(2026,9,30),r.INDICATORS)
        fundamentals.assert_not_called();self.assertNotIn('revenueGrowth',result['metrics']);self.assertTrue(result['limitations'])
    def test_compare_business_growth_is_not_price_growth_and_benchmark_dates_match(self):
        def hist(a,start,end):return dict(points=points(start-timedelta(days=1),(end-start).days+2),currency='USD',source='Fixture',url='https://example.com/quote',volume=100,volumeUnit='shares / session',fetchedAt='2026-10-04',dataAsOf=end.isoformat())
        fundamentals={'metrics':{'QuarterlyRevenueGrowthYOY':.1,'QuarterlyEarningsGrowthYOY':.2,'PERatio':25,'DividendYield':.01},'asOf':'2026-06-30','sourceUrl':'https://example.com/fundamentals'}
        with patch('research.history',side_effect=hist),patch('research.company_fundamentals',return_value=fundamentals):result=r.run({'template':'compare','assets':['AAPL','MSFT'],'timeframe':'quarter'},True)
        self.assertEqual(result['assets'][0]['metrics']['revenueGrowth'],.1);self.assertNotEqual(result['assets'][0]['metrics']['priceReturn'],.1)
        self.assertEqual(result['assets'][0]['metrics']['benchmarkExcess'],0);self.assertIsNone(result['interpretation']);self.assertTrue(result['sources'][0]['fetchedAt'])
        def shifted(a,start,end):
            data=hist(a,start,end)
            if a['type']=='Indexes':data['points']=data['points'][:-1]
            return data
        with patch('research.history',side_effect=shifted),patch('research.company_fundamentals',return_value=fundamentals):result=r.run({'template':'compare','assets':['AAPL','MSFT']},True)
        self.assertIsNone(result['assets'][0]['metrics']['benchmarkExcess'])
    def test_followup_retains_portfolio_scope_without_inventing_account_returns(self):
        portfolio={'kind':'portfolio','evidence':[r.evidence_item('P1','Positions',[{'id':'cash:USD','asset':APPLE|{'type':'Cash'},'quantity':10,'currency':'USD'}]),r.evidence_item('P2','Totals',{'value':10,'assetClassValues':{'Cash':10}})],'dataLimitations':['No full history']}
        with patch('research.portfolio_context',return_value=portfolio),patch('research.asset_news'):
            result=r.build({'template':'freeform','prompt':'What are the risks?','scope':'portfolio','assets':[],'holdings':[],'history':[{'question':'Portfolio?','takeaway':'Snapshot'}]})
        self.assertIsNotNone(result['portfolio']);self.assertIsNone(result['portfolio']['basketReturn']);self.assertIn('hypothetical',' '.join(result['limitations']).lower())
    def test_backend_enforces_plus_and_free_daily_limits_before_providers(self):
        with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'SHAREBAJAR_ACCOUNT_DB':d+'/db.sqlite'}):
            free={'template':'compare','assets':['AAPL','MSFT']}
            for _ in range(3):self.assertTrue(r.authorize(free,None,'ip'))
            with self.assertRaises(m.AppError) as e:r.authorize(free,None,'ip')
            self.assertEqual(e.exception.status,429)
            for body in [{'template':'freeform','prompt':'Compare AAPL'},free|{'prompt':'Give AI advice'},free|{'timeframe':'1y'},free|{'history':[{'question':'next'}]},{'template':'growth'}]:
                with self.assertRaises(m.AppError) as e:r.authorize(body,None,'new-ip')
                self.assertEqual(e.exception.status,401)
    def test_http_advanced_bypass_and_unknown_template_rejected(self):
        with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'SHAREBAJAR_ACCOUNT_DB':d+'/db.sqlite'}):
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                auth=__import__('membership').signup({'email':'validation@example.test','password':'a-long-test-password'})
                with patch('server.run_research') as run:
                    for body,code in [({'template':'freeform','prompt':'Analyze AAPL','plan':'plus'},401),({'template':'unknown'},400)]:
                        with self.assertRaises(HTTPError) as e:urlopen(Request('http://127.0.0.1:'+str(server.server_port)+'/api/research',data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+auth['token']} if body['template']=='unknown' else {})}))
                        self.assertEqual(e.exception.code,code)
                    run.assert_not_called()
            finally:server.shutdown();server.server_close();thread.join()

    def test_hypothetical_basket_uses_historical_prices_not_current_quotes(self):
        positions=[{'id':'AAPL','asset':APPLE,'quantity':2,'currency':'USD','value':1000},{'id':'cash:USD','asset':APPLE|{'id':'cash:USD','type':'Cash'},'quantity':10,'currency':'USD','value':10}]
        context={'evidence':[r.evidence_item('P1','Positions',positions),r.evidence_item('P2','Totals',{'value':1010,'assetClassValues':{'Stocks':1000,'Cash':10}})],'dataLimitations':['No transaction history']}
        def hist(a,start,end):return dict(points=points(start-timedelta(days=1),(end-start).days+2),currency='USD',source='Fixture',url='https://example.com',volume=1,volumeUnit='shares',fetchedAt='2026-10-04',dataAsOf=end.isoformat())
        with patch('research.portfolio_context',return_value=context),patch('research.history',side_effect=hist),patch('research.asset_news',return_value={'articles':[]}):result=r.build({'template':'portfolio-benchmark','benchmark':'^GSPC','currency':'USD','indicators':['price','benchmark']})
        self.assertAlmostEqual(result['portfolio']['basketReturn'],(394/210-1)*100)
        self.assertEqual(result['portfolio']['basketChart'][0]['value'],0)
        self.assertAlmostEqual(result['portfolio']['basketChart'][-1]['value'],result['portfolio']['basketReturn'])
        self.assertAlmostEqual(result['portfolio']['largestAssetWeight'],1000/1010*100)
    def test_natural_timeframe_mentions_and_asset_mentions(self):
        self.assertEqual(r.requested_period({'prompt':'Explain AAPL over the last year','timeframe':'quarter'}),'1y')
        self.assertEqual(r.requested_period({'prompt':'What about valuation?','timeframe':'1mo'}),'1mo')
        self.assertEqual(r.requested_period({'prompt':'Compare over the last completed quarter'}),'quarter')

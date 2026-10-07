import json
import threading
import unittest
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import server

class PublicAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True)
        cls.thread.start()
        cls.base='http://127.0.0.1:'+str(cls.http.server_port)+'/api/'
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();cls.thread.join()
    def get(self,path):
        try:
            with urlopen(self.base+path,timeout=5) as response:return response.status,json.load(response)
        except HTTPError as error:return error.code,json.load(error)
    def test_public_catalog(self):
        status,data=self.get('catalog');self.assertEqual(status,200);self.assertTrue(data['assets'])
    def test_global_crypto_stats(self):
        with patch.object(server.crypto,'get',return_value={'data':{'total_market_cap':{'usd':123}}}) as get:
            status,data=self.get('crypto/global')
        self.assertEqual(status,200);self.assertEqual(data['data']['total_market_cap']['usd'],123);get.assert_called_once_with('/global')
    def test_asset_news_without_login(self):
        with patch.object(server,'asset_news',return_value={'articles':[]}),patch.object(server,'resolve_asset',return_value={'name':'Bitcoin','symbol':'BTC'}):
            status,data=self.get('news?asset=crypto%3Abitcoin')
        self.assertEqual(status,200);self.assertEqual(data['articles'],[])
    def test_market_news_without_login(self):
        with patch.object(server,'market_news',return_value={'articles':[]}):status,data=self.get('news?market=United%20States')
        self.assertEqual(status,200)
    def test_invalid_requests(self):
        for path in ['crypto/markets','crypto/exchange','crypto/markets?id='+('a'*81),'crypto/assets?page=invalid','quotes?symbols=AAPL&range=invalid','quotes?symbols=']:
            with self.subTest(path=path):self.assertEqual(self.get(path)[0],400)
    def test_research_still_requires_pro(self):
        status,data=self.get('research/technicals?asset=AAPL');self.assertIn(status,[401,403])
    def test_provider_failure_is_service_unavailable(self):
        with patch.object(server.crypto,'get',side_effect=server.DataUnavailable('Provider unavailable')):
            status,data=self.get('crypto/global')
        self.assertEqual(status,503);self.assertEqual(data['error'],'Provider unavailable')

class PublicAIHTTP(PublicAPI):
    def test_usage_is_public(self):
        with patch.object(server,'public_ai_usage',return_value={'remaining':3,'limit':3}):
            status,data=self.get('ai/public/usage')
        self.assertEqual(status,200);self.assertEqual(data['remaining'],3)
    def test_anonymous_analysis_route(self):
        with patch.object(server,'public_asset_analysis',return_value={'asset':{'id':'AAPL'},'usage':{'remaining':2}}) as analyze:
            request=Request(self.base+'ai/public/asset',data=json.dumps({'id':'AAPL'}).encode(),headers={'Content-Type':'application/json'})
            with urlopen(request) as response:data=json.load(response);self.assertEqual(response.status,200)
        self.assertEqual(data['usage']['remaining'],2);self.assertEqual(analyze.call_args.args[0],{'id':'AAPL'})

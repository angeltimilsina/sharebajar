import os
import tempfile
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
import public_ai as ai
from membership import AppError

ASSET=dict(id='AAPL',symbol='AAPL',name='Apple',type='Stocks',exchange='NASDAQ',currency='USD')
FEED={'articles':[{'title':'Apple announces new product','publisher':'Fixture','url':'https://example.com/story','publishedAt':'2026-10-07T12:00:00Z'}]}
REPORT={'report':{'summary':'Short fixture analysis','sections':[],'limitations':[]},'sources':[],'generatedAt':'2026-10-07T12:00:00Z'}
class PublicAI(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'SHAREBAJAR_ACCOUNT_DB':self.temp.name+'/db.sqlite','OPENAI_API_KEY':'fixture'})
        self.env.start()
    def tearDown(self):self.env.stop();self.temp.cleanup()
    def analyze(self):
        with patch.object(ai,'resolve_asset',return_value=ASSET),patch.object(ai,'quote_snapshot',return_value={'price':100}),patch.object(ai,'asset_news',return_value=FEED),patch.object(ai,'generate_report',return_value=REPORT):return ai.analyze({'id':'AAPL'},'visitor')
    def test_three_successes_then_limit(self):
        for remaining in [2,1,0]:self.assertEqual(self.analyze()['usage']['remaining'],remaining)
        with self.assertRaises(AppError) as error:self.analyze()
        self.assertEqual(error.exception.status,429)
        self.assertEqual(ai.usage('other-visitor')['remaining'],3)
    def test_failure_refunds_quota(self):
        with patch.object(ai,'resolve_asset',side_effect=AppError('Provider unavailable',503)):
            with self.assertRaises(AppError):ai.analyze({'id':'AAPL'},'visitor')
        self.assertEqual(ai.usage('visitor')['remaining'],3)
    def test_no_news_does_not_consume_quota(self):
        with patch.object(ai,'resolve_asset',return_value=ASSET),patch.object(ai,'quote_snapshot',return_value={}),patch.object(ai,'asset_news',return_value={'articles':[]}):
            with self.assertRaises(AppError):ai.analyze({'id':'AAPL'},'visitor')
        self.assertEqual(ai.usage('visitor')['remaining'],3)
    def test_missing_key_does_not_consume_quota(self):
        with patch.dict(os.environ,{'OPENAI_API_KEY':''}):
            with self.assertRaises(AppError) as error:ai.analyze({'id':'AAPL'},'visitor')
        self.assertEqual(error.exception.code,'ai_not_configured')
        self.assertEqual(ai.usage('visitor')['remaining'],3)
    def test_invalid_question_and_asset(self):
        for body in [{'id':'../x'},{'id':'AAPL','question':'x'*501}]:
            with self.assertRaises(AppError):ai.analyze(body,'visitor')
        self.assertEqual(ai.usage('visitor')['remaining'],3)
    def test_concurrent_reservations_cannot_exceed_three(self):
        def take(_):
            try:ai.reserve('visitor');return True
            except AppError:return False
        with ThreadPoolExecutor(max_workers=6) as pool:self.assertEqual(sum(pool.map(take,range(6))),3)
    def test_next_day_resets_allowance(self):
        with patch.object(ai.time,'time',return_value=86400*20000+100):
            for _ in range(3):ai.reserve('visitor')
            self.assertEqual(ai.usage('visitor')['remaining'],0)
        with patch.object(ai.time,'time',return_value=86400*20001+100):self.assertEqual(ai.usage('visitor')['remaining'],3)
    def test_supplies_quote_and_news_to_ai(self):
        with patch.object(ai,'resolve_asset',return_value=ASSET),patch.object(ai,'quote_snapshot',return_value={'price':100}),patch.object(ai,'asset_news',return_value=FEED),patch.object(ai,'generate_report',return_value=REPORT) as generate:
            result=ai.analyze({'id':'AAPL'},'visitor')
        context=generate.call_args.args[0]
        self.assertEqual([e['id'] for e in context['evidence']],['A1','Q1','N1'])
        self.assertEqual(result['articles'],FEED['articles'])

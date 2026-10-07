import math
import json
import os
import tempfile
import threading
import time
import unittest
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request,urlopen

import membership
import research_history
import technical_analysis as ta
from server import Handler


def synthetic_candles(count=260):
    start=int(datetime.now(timezone.utc).timestamp())-(count-1)*86400
    return [{'time':start+index*86400,'open':100+index*.1,'high':101+index*.1,'low':99+index*.1,'close':100+index*.1,'volume':1000} for index in range(count)]


class TechnicalAnalysisTests(unittest.TestCase):
    def test_yahoo_candles_generate_deterministic_indicators_and_projection(self):
        candles=synthetic_candles()
        raw={'chart':{'result':[{'meta':{'currency':'USD'},'timestamp':[c['time'] for c in candles],'indicators':{'quote':[{key:[c[key] for c in candles] for key in ('open','high','low','close','volume')}]}}]}}
        with patch('technical_analysis.request_json',return_value=raw):
            result=ta.build_technicals('AAPL','3mo','1mo')
        self.assertGreaterEqual(len(result['candles']),89)
        self.assertAlmostEqual(result['latestIndicators']['sma20'],124.95)
        self.assertIn('bollingerLower',result['indicators'])
        self.assertTrue(result['projection']['available'])
        self.assertLess(result['projection']['lower'],result['projection']['median'])
        self.assertLess(result['projection']['median'],result['projection']['upper'])
        self.assertTrue(all(math.isfinite(point['value']) for values in result['indicators'].values() for point in values))

    def test_coin_gecko_ohlc_rows_are_validated_and_mapped(self):
        rows=[[1700000000000,10,12,9,11],[1700086400000,11,10,8,9],[1700172800000,9,12,8,11]]
        asset={'id':'crypto:bitcoin','symbol':'BTC','name':'Bitcoin','type':'Crypto','currency':'USD'}
        with patch('technical_analysis.resolve_asset',return_value=asset),patch('technical_analysis.CoinGeckoProvider.get',return_value=rows):
            result=ta.candles_for(asset)
        self.assertEqual(len(result['candles']),2)
        self.assertEqual(result['candles'][0]['open'],10)
        self.assertEqual(result['candles'][0]['volume'],None)

    def test_projection_validation_and_minimum_history_are_explicit(self):
        with self.assertRaises(membership.AppError):ta.scenario_projection(synthetic_candles(10),'2w')
        unavailable=ta.scenario_projection(synthetic_candles(15),'1w')
        self.assertFalse(unavailable['available'])
        self.assertIn('20',unavailable['reason'])

    def test_research_history_is_account_owned_and_deletable(self):
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'SHAREBAJAR_ACCOUNT_DB':directory+'/accounts.sqlite'}):
            with membership.database() as db:
                for user_id,email in [('user-one','one@example.com'),('user-two','two@example.com')]:
                    db.execute('INSERT INTO users(id,email,password,salt) VALUES(?,?,?,?)',(user_id,email,'x','00'*16))
            result={'interpretation':{'report':{'summary':'A dated answer.'}}}
            saved=research_history.save_exchange('user-one',None,'Explain AAPL',result,{'assetId':'AAPL','horizon':'1mo'})
            conversation_id=saved['conversationId']
            conversation=research_history.get_conversation('user-one',conversation_id)
            self.assertEqual([message['role'] for message in conversation['messages']],['user','assistant'])
            self.assertEqual(research_history.history_for_model('user-one',conversation_id),[{'question':'Explain AAPL','takeaway':'A dated answer.'}])
            with self.assertRaises(membership.AppError) as error:research_history.get_conversation('user-two',conversation_id)
            self.assertEqual(error.exception.status,404)
            research_history.delete_conversation('user-one',conversation_id)
            self.assertEqual(research_history.list_conversations('user-one')['total'],0)

    def test_http_research_routes_enforce_pro_and_conversation_ownership(self):
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'SHAREBAJAR_ACCOUNT_DB':directory+'/accounts.sqlite','OPENAI_API_KEY':'test-key'}):
            first=membership.signup({'email':'first@example.com','password':'a-very-secure-password'})
            second=membership.signup({'email':'second@example.com','password':'another-secure-password'})
            with membership.database() as db:db.execute("UPDATE users SET plan='pro',plan_expires=?",(time.time()+86400,))
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base='http://127.0.0.1:'+str(server.server_port)+'/api/'
            try:
                public_chart={'asset':{'id':'AAPL','symbol':'AAPL'},'candles':[],'source':'Fixture','sourceUrl':'https://example.com','fetchedAt':'now','range':'3mo'}
                with patch('server.build_technicals',return_value=public_chart) as build:
                    request=Request(base+'research/technicals?asset=AAPL',headers={'Authorization':'Bearer '+first['token']})
                    with urlopen(request) as response:self.assertEqual(response.status,200)
                    build.assert_called_once()
                technical={'asset':{'id':'AAPL','symbol':'AAPL','name':'Apple'},'candles':[{'time':1}],'source':'Fixture','sourceUrl':'https://example.com','fetchedAt':'now','latestIndicators':{},'projection':{}}
                model_result={'takeaway':'A sourced answer.','interpretation':{'report':{'summary':'A sourced answer.'}}}
                with patch('server.build_technicals',return_value=technical),patch('server.run_research',return_value=model_result):
                    body={'prompt':'Explain this asset.','assetId':'AAPL','chartRange':'3mo','horizon':'1mo'}
                    request=Request(base+'research/chat',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+first['token'],'Content-Type':'application/json'})
                    with urlopen(request) as response:result=json.loads(response.read())
                conversation_id=result['conversationId']
                request=Request(base+'research/conversations/'+conversation_id,headers={'Authorization':'Bearer '+second['token']})
                with self.assertRaises(HTTPError) as error:urlopen(request)
                self.assertEqual(error.exception.code,404)
                request=Request(base+'research/conversations/'+conversation_id,headers={'Authorization':'Bearer '+first['token']},method='DELETE')
                with urlopen(request) as response:self.assertEqual(json.loads(response.read()),{'deleted':True})
                with membership.database() as db:db.execute("UPDATE users SET plan='free' WHERE email='second@example.com'")
                request=Request(base+'research/technicals?asset=AAPL',headers={'Authorization':'Bearer '+second['token']})
                with self.assertRaises(HTTPError) as error:urlopen(request)
                self.assertEqual(error.exception.code,403)
            finally:server.shutdown();server.server_close();thread.join()

import unittest
from providers import normalize_chart, DataUnavailable
class Quotes(unittest.TestCase):
    def test_normalization_excludes_missing_history(self):
        data={'chart':{'result':[{'meta':{'regularMarketPrice':110,'chartPreviousClose':100,'currency':'USD'},'timestamp':[1,2,3],'indicators':{'quote':[{'close':[100,None,110]}]}}]}}
        result=normalize_chart(data,'TEST')
        self.assertAlmostEqual(result['changePercent'],10)
        self.assertEqual(result['previousClose'],100)
        self.assertEqual(len(result['history']),2)
    def test_missing_quote_is_an_error(self):
        with self.assertRaises(DataUnavailable): normalize_chart({'chart':{'result':None}},'TEST')
    def test_zero_close_does_not_divide_by_zero(self):
        result=normalize_chart({'chart':{'result':[{'meta':{'regularMarketPrice':1,'chartPreviousClose':0}}]}},'TEST')
        self.assertIsNone(result['changePercent'])

class Adapters(unittest.TestCase):
    def test_cex_listings_exclude_unclassified_and_decentralized(self):
        from unittest.mock import patch
        from providers import CoinGeckoProvider
        provider=CoinGeckoProvider()
        listings={'tickers':[{'market':{'identifier':'cex'}},{'market':{'identifier':'dex'}},{'market':{'identifier':'unknown'}}]}
        exchanges=[{'id':'cex','centralized':True},{'id':'dex','centralized':False}]
        with patch.object(provider,'get',return_value=listings), patch.object(provider,'verify_exchanges',return_value=[{'id':'cex','centralized':True}]):
            data=provider.get_markets('test')
        self.assertEqual([t['market']['identifier'] for t in data['tickers']],['cex'])
    def test_historical_chart_uses_daily_close_for_daily_movement(self):
        from unittest.mock import patch
        from providers import YahooProvider
        def response(price,previous):
            return {'chart':{'result':[{'meta':{'regularMarketPrice':price,'chartPreviousClose':previous},'timestamp':[1,2],'indicators':{'quote':[{'close':[10,20]}]}}]}}
        with patch('providers.request_json',side_effect=[response(20,10),response(20,19)]):
            data=YahooProvider().quote('TEST','1mo')
        self.assertEqual(data['previousClose'],19)
        self.assertEqual(data['change'],1)
        self.assertEqual(data['history'][0]['value'],10)
    def test_no_market_session_is_not_claimed_closed(self):
        data={'chart':{'result':[{'meta':{'regularMarketPrice':1,'chartPreviousClose':1}}]}}
        self.assertEqual(normalize_chart(data,'TEST')['status'],'Not supplied')
    def test_exchange_detail_carries_requested_id(self):
        from unittest.mock import patch
        from providers import CoinGeckoProvider
        with patch('providers.request_json',return_value={'name':'Test Exchange','centralized':True}):
            data=CoinGeckoProvider().get_exchange('test-exchange')
        self.assertEqual(data['id'],'test-exchange')

import unittest
from unittest.mock import patch
import news_brief as brief
from membership import AppError


class NewsBriefTests(unittest.TestCase):
    def setUp(self):
        brief._cache.clear()
        self.feed = dict(fetchedAt='2026-10-05T12:00:00Z', articles=[dict(title='Headline '+str(i), publisher='Publisher', url='https://example.com/'+str(i), publishedAt='2026-10-05T11:00:00Z') for i in range(6)])

    def test_public_preview_is_bounded_and_generation_is_cached(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY':'test'}), patch.object(brief,'market_news',return_value=self.feed), patch.object(brief,'generate_report',return_value={'report':{'summary':'A concise headline summary.'},'generatedAt':'2026-10-05T12:00:01Z'}) as generate:
            first=brief.news_brief('United States')
            second=brief.news_brief('United States')
        self.assertEqual(first,second)
        self.assertEqual(len(first['articles']),2)
        self.assertEqual(first['status'],'ready')
        self.assertNotIn('report',first)
        generate.assert_called_once()
        self.assertEqual(len(generate.call_args.args[0]['evidence']),6)

    def test_model_failure_keeps_headlines_without_claiming_ai_summary(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY':'test'}), patch.object(brief,'market_news',return_value=self.feed), patch.object(brief,'generate_report',side_effect=AppError('Unavailable',503)):
            result=brief.news_brief('United States')
        self.assertIsNone(result['summary'])
        self.assertEqual(result['status'],'unavailable')
        self.assertEqual(len(result['articles']),2)

    def test_unknown_market_does_not_call_providers(self):
        with patch.object(brief,'market_news') as fetch:
            with self.assertRaises(AppError):brief.news_brief('unknown')
            fetch.assert_not_called()

    def test_selected_asset_uses_its_own_news_feed(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY':''}), patch.object(brief,'resolve_asset',return_value={'id':'AAPL','name':'Apple','symbol':'AAPL'}), patch.object(brief,'asset_news',return_value=self.feed) as fetch, patch.object(brief,'market_news') as market:
            result=brief.news_brief('United States','AAPL')
        fetch.assert_called_once_with('Apple','AAPL')
        market.assert_not_called()
        self.assertEqual(len(result['articles']),2)

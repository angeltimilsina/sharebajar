import unittest
from unittest.mock import patch
from news import category_news, NEWS_CATEGORIES

class CategoryNewsTests(unittest.TestCase):
    def test_categories_cover_major_market_topics(self):
        self.assertEqual(len(NEWS_CATEGORIES),22)
        for key in ['stocks','crypto','economy','central-banks','bonds','commodities','technology','geopolitics']:
            self.assertIn(key,NEWS_CATEGORIES)

    def test_feed_scopes_category_region_and_freshness(self):
        with patch('news.fetch_headlines',return_value={'articles':[]}) as fetch:
            result=category_news('technology','India')
        self.assertIn('India',fetch.call_args.args[0])
        self.assertIn('when:1d',fetch.call_args.args[0])
        self.assertEqual(result['categoryTitle'],'Technology')

    def test_invalid_category_and_region_do_not_fetch(self):
        with patch('news.fetch_headlines') as fetch:
            for category,market in [('unknown','Global'),('stocks','unknown')]:
                with self.assertRaises(ValueError):category_news(category,market)
            fetch.assert_not_called()

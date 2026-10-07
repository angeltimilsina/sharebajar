import unittest
from unittest.mock import patch
from news import today_news

class TodayNewsTests(unittest.TestCase):
    def test_local_day_filters_old_unknown_and_next_day_headlines(self):
        articles=[dict(title='Old',publishedAt='2026-10-05T04:59:00+00:00'),dict(title='Today',publishedAt='2026-10-05T12:00:00+00:00'),dict(title='Tomorrow',publishedAt='2026-10-06T05:00:00+00:00'),dict(title='Unknown',publishedAt=None)]
        with patch('news.fetch_headlines',return_value={'articles':articles}) as fetch:
            result=today_news('United States','2026-10-05T05:00:00Z','2026-10-06T05:00:00Z')
        self.assertEqual([a['title'] for a in result['articles']],['Today'])
        self.assertIn('when:1d',fetch.call_args.args[0])

    def test_invalid_day_does_not_fetch(self):
        with patch('news.fetch_headlines') as fetch:
            with self.assertRaises(ValueError):today_news('United States','2026-10-05','2026-10-06')
            fetch.assert_not_called()

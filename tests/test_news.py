import unittest
from unittest.mock import patch
from news import normalize_news, market_news, safe_link
from providers import DataUnavailable

class News(unittest.TestCase):
    def test_headlines_keep_publisher_and_time_and_drop_unsafe_links(self):
        xml=b'''<rss><channel>
        <item><title>Older story - Publisher</title><link>https://example.com/older</link><source url="https://example.com">Publisher</source><pubDate>Fri, 02 Oct 2026 10:00:00 GMT</pubDate></item>
        <item><title>New story - Publisher</title><link>https://example.com/new</link><source url="https://example.com">Publisher</source><pubDate>Sat, 03 Oct 2026 10:00:00 GMT</pubDate></item>
        <item><title>New story - Publisher</title><link>https://example.com/duplicate</link><source>Publisher</source></item>
        <item><title>Unsafe story</title><link>javascript:alert(1)</link><source>Publisher</source></item>
        <item><title>Missing source</title><link>https://example.com/missing</link></item>
        </channel></rss>'''
        items=normalize_news(xml)
        self.assertEqual(len(items),2)
        self.assertEqual(items[0]['title'],'New story')
        self.assertEqual(items[0]['publisher'],'Publisher')
        self.assertEqual(items[0]['publishedAt'],'2026-10-03T10:00:00+00:00')
        self.assertEqual(items[0]['url'],'https://example.com/new')

    def test_invalid_feed_is_unavailable(self):
        for xml in [b'not xml',b'<html>blocked</html>',b'<!DOCTYPE rss><rss><channel/></rss>']:
            with self.assertRaises(DataUnavailable): normalize_news(xml)

    def test_missing_date_remains_explicit_and_source_url_is_validated(self):
        items=normalize_news(b'<rss><channel><item><title>News</title><link>https://example.com/news</link><source url="javascript:alert(1)">Publisher</source><pubDate>unknown</pubDate></item></channel></rss>')
        self.assertIsNone(items[0]['publishedAt'])
        self.assertEqual(items[0]['publisherUrl'],'')
        self.assertEqual(safe_link('https://user:secret@example.com/news'),'')

    def test_unknown_market_never_makes_external_request(self):
        with patch('news.urlopen') as request:
            with self.assertRaises(ValueError): market_news('https://internal.example')
            request.assert_not_called()

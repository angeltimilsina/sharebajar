import json,os,re,unittest
from unittest.mock import patch
from xml.etree import ElementTree
import market_pages as pages
from market_catalog import MARKETS,TYPES,assets_for,ranked_assets

class MarketPages(unittest.TestCase):
    def test_all_market_routes_have_server_rendered_metadata(self):
        for market in MARKETS:
            code=market['marketCode']
            for suffix in ['',*TYPES]:
                path='/markets/'+code+('/'+suffix if suffix else '')
                with self.subTest(path=path):
                    body=pages.render(path)
                    self.assertIn('<h1>',body);self.assertIn('name="description"',body)
                    self.assertIn('rel="canonical"',body);self.assertIn('BreadcrumbList',body)
                    self.assertIn('Mock data preview',body);self.assertNotIn('src="/app.js',body)
    def test_market_specific_stock_data_and_asset_backlinks(self):
        for m in MARKETS:
            for asset in assets_for(m['marketCode']):
                body=pages.render(pages.asset_url(asset))
                self.assertIn(asset['symbol'],body);self.assertIn('/markets/'+m['marketCode']+'/'+asset['assetType'],body)
        body=pages.render('/markets/nepal/stocks')
        self.assertIn('Top Stocks in Nepal',body);self.assertIn('/asset/nepal/NABIL',body);self.assertNotIn('/asset/us/AAPL',body)
    def test_filters_and_ranking_directions(self):
        winners=ranked_assets('us','gainers',period='7d');losers=ranked_assets('us','losers',period='7d')
        self.assertTrue(all(a['changes']['7d']>0 for a in winners));self.assertTrue(all(a['changes']['7d']<0 for a in losers))
        self.assertEqual([a['changes']['7d'] for a in losers],sorted(a['changes']['7d'] for a in losers))
        self.assertTrue(all(a['sector']=='technology' for a in ranked_assets('us',sector='technology')))
        self.assertTrue(all(a['marketCode']=='crypto' for a in ranked_assets('nepal','crypto')))
    def test_sitemap_routes_resolve(self):
        doc=ElementTree.fromstring(pages.sitemap());ns={'s':'http://www.sitemaps.org/schemas/sitemap/0.9'}
        for loc in doc.findall('s:url/s:loc',ns):
            from urllib.parse import urlsplit
            path=urlsplit(loc.text).path
            if path!='/':
                from financial_pages import render as render_financial
                self.assertTrue(pages.parse_route(path) is not None or render_financial(path) is not None,path)
    def test_invalid_routes(self):
        for path in ['/markets/unknown','/markets/us/anything','/asset/us/UNKNOWN','/markets/us/sectors/invalid']:
            self.assertIsNone(pages.render(path))
    def test_canonical_excludes_query_and_uses_public_domain(self):
        with patch.dict(os.environ,{'SHAREBAJAR_PUBLIC_URL':'https://example.com'}):
            body=pages.render('/markets/us/stocks','range=7d')
        self.assertIn('href="https://example.com/markets/us/stocks"',body)
    def test_config_required_fields(self):
        fields={'marketCode','countryName','currency','currencySymbol','exchangeNames','defaultAssetTypes','topIndexName','locale','timezone'}
        self.assertEqual(len(MARKETS),18)
        for m in MARKETS:self.assertTrue(fields.issubset(m))

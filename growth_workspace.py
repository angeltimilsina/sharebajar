"""Account-owned financial research workspace with explicit mock-data adapters.

This API is shared by web and mobile clients. Portfolio valuations never combine
unconverted currencies. Membership grants come from the existing account system.
"""
import csv
import html
import io
import json
import math
import secrets
import time
from contextlib import contextmanager

import membership
from market_catalog import BY_CODE, assets_for

VIEWS = ('overview', 'watchlist', 'portfolio', 'research', 'forecast', 'reports', 'templates', 'alerts', 'settings')
TEMPLATES = [
    {'id': 'portfolio-risk', 'name': 'Portfolio Risk Report', 'plan': 'plus', 'description': 'Measure concentration and sector exposure from recorded holdings.'},
    {'id': 'valuation-review', 'name': 'Valuation Review', 'plan': 'plus', 'description': 'Review mock valuation, unrealized gains, and research questions.'},
    {'id': 'asset-research', 'name': 'Asset Research Brief', 'plan': 'plus', 'description': 'Build a concise, data-grounded brief for a saved asset.'},
    {'id': 'scenario-forecast', 'name': 'Scenario Forecast', 'plan': 'pro', 'description': 'Explore illustrative bear, base, and bull assumptions.'},
    {'id': 'multi-portfolio', 'name': 'Multi-Portfolio Review', 'plan': 'pro', 'description': 'Compare portfolios without adding unconverted currencies.'},
]


def _user(user):
    if not user or not user.get('id') or user.get('disabled'):
        raise membership.AppError('Sign in to open your financial workspace.', 401, 'unauthorized')
    return user


def _number(value, label, minimum=0, maximum=1e12):
    if isinstance(value, bool):
        raise membership.AppError('Enter a valid ' + label + '.')
    try:
        result = float(value)
    except (ValueError, TypeError, OverflowError):
        raise membership.AppError('Enter a valid ' + label + '.') from None
    if not math.isfinite(result) or result < minimum or result > maximum:
        raise membership.AppError('Enter a valid ' + label + '.')
    return result


def _text(value, label, maximum=100, default=''):
    if value is None:
        value = default
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum:
        raise membership.AppError('Enter a valid ' + label + '.')
    value = value.strip()
    if any(ord(c) < 32 for c in value):
        raise membership.AppError('Enter a valid ' + label + '.')
    return value


def _asset(code, symbol):
    if not isinstance(code, str) or code not in BY_CODE or not isinstance(symbol, str) or len(symbol) > 40:
        raise membership.AppError('Choose a supported asset and market.')
    asset = next((a for a in assets_for(code) if a['symbol'].upper() == symbol.upper()), None)
    if not asset:
        raise membership.AppError('This asset is not in the mock market catalog.', 404, 'asset_not_found')
    return dict(asset)


@contextmanager
def _database():
    with membership.database() as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS growth_watchlist(
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                market_code TEXT NOT NULL, symbol TEXT NOT NULL, created_at REAL NOT NULL,
                PRIMARY KEY(user_id,market_code,symbol));
            CREATE TABLE IF NOT EXISTS growth_portfolios(
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL, holdings TEXT NOT NULL, source TEXT NOT NULL,
                created_at REAL NOT NULL, updated_at REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS growth_portfolios_owner ON growth_portfolios(user_id,updated_at DESC);
            CREATE TABLE IF NOT EXISTS growth_reports(
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL, template TEXT NOT NULL, content TEXT NOT NULL, created_at REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS growth_reports_owner ON growth_reports(user_id,created_at DESC);
            CREATE TABLE IF NOT EXISTS growth_alerts(
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                market_code TEXT NOT NULL, symbol TEXT NOT NULL, direction TEXT NOT NULL,
                threshold REAL NOT NULL, created_at REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS growth_preferences(
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                market_code TEXT NOT NULL DEFAULT 'us', risk_profile TEXT NOT NULL DEFAULT 'balanced',
                horizon TEXT NOT NULL DEFAULT 'long-term');
        ''')
        yield db


def _permissions(user):
    plan = membership.effective_plan(user)
    paid = plan in ('plus', 'pro')
    return {'plan': plan, 'watchlist': True, 'portfolioImport': paid, 'research': paid,
            'risk': paid, 'savedReports': paid, 'templates': paid, 'alerts': paid,
            'forecast': plan == 'pro', 'multiPortfolio': plan == 'pro', 'export': plan == 'pro',
            'watchlistLimit': {'free': 25, 'plus': 200, 'pro': 500}[plan],
            'portfolioLimit': 10 if plan == 'pro' else 1}


def _portfolio(row):
    result = {'id': row['id'], 'name': row['name'], 'source': row['source'],
              'createdAt': row['created_at'], 'updatedAt': row['updated_at'], 'holdings': [], 'isMock': True}
    totals = {}
    for holding in json.loads(row['holdings']):
        a = _asset(holding['marketCode'], holding['symbol'])
        quantity = holding['quantity']
        value = round(a['price'] * quantity, 2)
        cost = round(holding['costBasis'] * quantity, 2)
        current = dict(holding, name=a['name'], price=a['price'], currency=a['currency'],
                       sector=a['sector'], assetType=a['assetType'], marketValue=value,
                       costValue=cost, unrealizedGain=round(value - cost, 2))
        result['holdings'].append(current)
        total = totals.setdefault(a['currency'], {'value': 0, 'cost': 0, 'gain': 0})
        total['value'] = round(total['value'] + value, 2)
        total['cost'] = round(total['cost'] + cost, 2)
        total['gain'] = round(total['gain'] + value - cost, 2)
    result['totalsByCurrency'] = totals
    result['risk'] = _risk(result['holdings'])
    return result


def _risk(holdings):
    groups = {}
    for h in holdings:
        groups.setdefault(h['currency'], []).append(h)
    summaries = []
    for currency, rows in groups.items():
        total = sum(h['marketValue'] for h in rows)
        sectors, assets = {}, {}
        for h in rows:
            sectors[h['sector']] = sectors.get(h['sector'], 0) + h['marketValue']
            key = h['marketCode'] + ':' + h['symbol']
            assets[key] = assets.get(key, 0) + h['marketValue']
        weights = [v / total if total else 0 for v in assets.values()]
        largest = max(weights, default=0) * 100
        score = round(sum(w * w for w in weights) * 100)
        summaries.append({'currency': currency, 'value': round(total, 2), 'largestPositionPercent': round(largest, 1),
                          'concentrationScore': score, 'concentrationLabel': 'High' if largest >= 40 else 'Moderate' if largest >= 25 else 'Lower',
                          'sectorAllocation': [{'sector': s, 'percent': round(v / total * 100, 1) if total else 0} for s, v in sorted(sectors.items(), key=lambda x: x[1], reverse=True)]})
    return {'method': 'Position concentration per currency; no volatility, correlations, FX, or suitability assessment.',
            'byCurrency': summaries, 'holdingsCount': len(holdings), 'isMock': True}


def _scenarios(portfolio):
    return {'portfolioId': portfolio['id'], 'horizon': '12 months', 'isMock': True,
            'method': 'Illustrative constant portfolio price changes. Assumptions exclude fees, dividends, taxes, and exchange rates. These are scenarios, not predictions.',
            'byCurrency': [{ 'currency': c, 'currentValue': t['value'],
                            'scenarios': [{'name': n, 'changePercent': percent, 'value': round(t['value'] * (1 + percent / 100), 2)} for n, percent in [('Bear', -20), ('Base', 5), ('Bull', 20)]]}
                           for c, t in portfolio['totalsByCurrency'].items()]}


def get_state(user):
    user = _user(user)
    permissions = _permissions(user)
    with _database() as db:
        watch = [dict(_asset(r['market_code'], r['symbol']), savedAt=r['created_at']) for r in db.execute('SELECT * FROM growth_watchlist WHERE user_id=? ORDER BY created_at DESC', (user['id'],))]
        portfolios = [_portfolio(r) for r in db.execute('SELECT * FROM growth_portfolios WHERE user_id=? ORDER BY updated_at DESC', (user['id'],))] if permissions['portfolioImport'] else []
        reports = [{'id': r['id'], 'title': r['title'], 'template': r['template'], 'content': json.loads(r['content']), 'createdAt': r['created_at']} for r in db.execute('SELECT * FROM growth_reports WHERE user_id=? ORDER BY created_at DESC LIMIT 100', (user['id'],))] if permissions['savedReports'] else []
        alerts = []
        if permissions['alerts']:
            for row in db.execute('SELECT * FROM growth_alerts WHERE user_id=? ORDER BY created_at DESC', (user['id'],)):
                a = _asset(row['market_code'], row['symbol'])
                crossed = a['price'] >= row['threshold'] if row['direction'] == 'above' else a['price'] <= row['threshold']
                alerts.append({'id': row['id'], 'asset': a, 'direction': row['direction'], 'threshold': row['threshold'], 'status': 'Threshold met in mock snapshot' if crossed else 'Watching mock snapshot', 'createdAt': row['created_at'], 'delivery': 'in-app only'})
        row = db.execute('SELECT * FROM growth_preferences WHERE user_id=?', (user['id'],)).fetchone()
        preferences = {'marketCode': row['market_code'], 'riskProfile': row['risk_profile'], 'horizon': row['horizon']} if row else {'marketCode': 'us', 'riskProfile': 'balanced', 'horizon': 'long-term'}
    return {'account': {'email': user['email'], 'plan': permissions['plan']}, 'permissions': permissions,
            'preferences': preferences, 'watchlist': watch, 'portfolios': portfolios,
            'reports': reports, 'alerts': alerts, 'templates': TEMPLATES,
            'scenarios': [_scenarios(p) for p in portfolios] if permissions['forecast'] else [],
            'dataMode': 'mock', 'researchMode': 'structured mock analysis',
            'dataNotice': 'Illustrative prices and research. Imported quantities are yours; market prices are mock data. No broker connection or external alerts are active.'}


def _holdings(body):
    rows = body.get('holdings')
    if 'csv' in body:
        text = body['csv']
        if not isinstance(text, str) or len(text) > 100000:
            raise membership.AppError('Upload a CSV smaller than 100 KB.')
        try:
            reader = csv.DictReader(io.StringIO(text))
            if not reader.fieldnames or not {'marketCode', 'symbol', 'quantity'} <= set(reader.fieldnames):
                raise membership.AppError('CSV headers must include marketCode, symbol, quantity, and optionally costBasis.')
            rows = list(reader)
        except csv.Error:
            raise membership.AppError('Unable to read this CSV.') from None
    if not isinstance(rows, list) or not 1 <= len(rows) <= 200:
        raise membership.AppError('Import between 1 and 200 holdings.')
    result = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise membership.AppError('Each holding must contain a market, symbol, and quantity.')
        a = _asset(row.get('marketCode'), row.get('symbol'))
        key = (a['marketCode'], a['symbol'])
        if key in seen:
            raise membership.AppError('Combine repeated holdings for the same market and symbol before import.')
        seen.add(key)
        quantity = _number(row.get('quantity'), 'quantity', minimum=0.00000001, maximum=1e9)
        basis = row.get('costBasis')
        basis = a['price'] if basis in (None, '') else _number(basis, 'cost basis')
        result.append({'marketCode': a['marketCode'], 'symbol': a['symbol'], 'quantity': quantity, 'costBasis': basis})
    return result


def _owned(db, table, user, item_id):
    if not isinstance(item_id, str) or len(item_id) > 64:
        raise membership.AppError('Choose a valid saved item.')
    row = db.execute('SELECT * FROM ' + table + ' WHERE id=? AND user_id=?', (item_id, user['id'])).fetchone()
    if not row:
        raise membership.AppError('Saved item not found.', 404, 'not_found')
    return row


def _report(user, body, db):
    template = next((t for t in TEMPLATES if t['id'] == body.get('template')), None)
    if not template:
        raise membership.AppError('Choose a supported research template.')
    membership.require_plan(user, template['plan'])
    prompt = body.get('prompt', '')
    if not isinstance(prompt, str) or len(prompt) > 1000:
        raise membership.AppError('Keep your research question under 1,000 characters.')
    portfolios = [_portfolio(r) for r in db.execute('SELECT * FROM growth_portfolios WHERE user_id=? ORDER BY updated_at DESC', (user['id'],))]
    selected = None
    if body.get('portfolioId'):
        selected = _portfolio(_owned(db, 'growth_portfolios', user, body['portfolioId']))
    elif portfolios:
        selected = portfolios[0]
    content = {'dataMode': 'mock', 'engine': 'structured research template', 'question': prompt.strip(), 'sections': [],
               'limitations': 'Mock prices. Structured template analysis, not a live AI model output. No suitability assessment or personalized investment advice.'}
    sections = content['sections']
    if template['id'] == 'asset-research':
        a = _asset(body.get('marketCode', 'us'), body.get('symbol', 'AAPL'))
        sections += [{'heading': 'Asset snapshot', 'body': a['name'] + ' (' + a['symbol'] + ') trades in the ' + BY_CODE[a['marketCode']]['countryName'] + ' mock catalog at ' + a['currency'] + ' ' + format(a['price'], ',.2f') + '.'},
                     {'heading': 'Research context', 'body': 'Mock daily move: ' + format(a['changes']['1d'], '+.2f') + '%. Sector: ' + a['sector'] + '. Check earnings quality, valuation assumptions, liquidity, and primary company filings before drawing conclusions.'}]
        content['asset'] = {'marketCode': a['marketCode'], 'symbol': a['symbol']}
    elif template['id'] == 'multi-portfolio':
        if not portfolios:
            raise membership.AppError('Import a portfolio before generating this report.')
        sections.append({'heading': 'Portfolio comparison', 'body': 'You have ' + str(len(portfolios)) + ' recorded portfolios. Compare each currency separately; there is no consolidated FX-adjusted total.'})
        content['portfolios'] = [{'name': p['name'], 'totalsByCurrency': p['totalsByCurrency'], 'risk': p['risk']} for p in portfolios]
    else:
        if not selected:
            raise membership.AppError('Import a portfolio before generating this report.')
        content['portfolioId'] = selected['id']
        sections.append({'heading': 'Recorded portfolio', 'body': selected['name'] + ' contains ' + str(len(selected['holdings'])) + ' holdings. All market values use illustrative prices.'})
        for risk in selected['risk']['byCurrency']:
            sections.append({'heading': risk['currency'] + ' concentration', 'body': 'Largest asset weight is ' + str(risk['largestPositionPercent']) + '%. Concentration score: ' + str(risk['concentrationScore']) + '/100. This measures position weights, not a probability of loss.'})
        content['totalsByCurrency'] = selected['totalsByCurrency']
        if template['id'] == 'scenario-forecast':
            content['scenarios'] = _scenarios(selected)
            sections.append({'heading': 'Scenario assumptions', 'body': 'Bear -20%, base +5%, bull +20% over 12 months. These fixed assumptions are illustrative scenarios, not forecasts of market returns.'})
        if template['id'] == 'valuation-review':
            sections.append({'heading': 'Valuation questions', 'body': 'Review earnings durability, dividend coverage, debt, cash flow, and peer multiples with real filings. Mock prices alone cannot determine whether an asset is undervalued.'})
    sections.append({'heading': 'Next research steps', 'body': 'Open the linked market rankings, validate current data with a real provider, and compare assumptions before making an investment decision.'})
    return template, content


def mutate(user, body):
    user = _user(user)
    if not isinstance(body, dict):
        raise membership.AppError('Send a JSON object.')
    action = body.get('action')
    permissions = _permissions(user)
    now = time.time()
    with _database() as db:
        db.execute('BEGIN IMMEDIATE')
        if action in ('watch_add', 'watch_remove'):
            a = _asset(body.get('marketCode'), body.get('symbol'))
            if action == 'watch_add':
                exists = db.execute('SELECT 1 FROM growth_watchlist WHERE user_id=? AND market_code=? AND symbol=?', (user['id'], a['marketCode'], a['symbol'])).fetchone()
                count = db.execute('SELECT COUNT(*) FROM growth_watchlist WHERE user_id=?', (user['id'],)).fetchone()[0]
                if not exists and count >= permissions['watchlistLimit']:
                    raise membership.AppError('Your watchlist limit is reached.', 403, 'upgrade_required', 'plus' if permissions['plan'] == 'free' else 'pro')
                db.execute('INSERT OR IGNORE INTO growth_watchlist VALUES(?,?,?,?)', (user['id'], a['marketCode'], a['symbol'], now))
                message = 'Asset saved to your watchlist.'
            else:
                db.execute('DELETE FROM growth_watchlist WHERE user_id=? AND market_code=? AND symbol=?', (user['id'], a['marketCode'], a['symbol']))
                message = 'Asset removed from your watchlist.'
        elif action in ('portfolio_import', 'demo_sync'):
            membership.require_plan(user, 'plus')
            name = _text(body.get('name'), 'portfolio name', 80, 'My Portfolio')
            if action == 'demo_sync':
                code = body.get('marketCode', 'us')
                if code not in BY_CODE:
                    raise membership.AppError('Choose a supported market.')
                rows = assets_for(code)[:3]
                holdings = [{'marketCode': code, 'symbol': a['symbol'], 'quantity': 10.0, 'costBasis': round(a['price'] * 0.9, 2)} for a in rows]
            else:
                holdings = _holdings(body)
            existing = _owned(db, 'growth_portfolios', user, body['portfolioId']) if body.get('portfolioId') else None
            if not existing:
                count = db.execute('SELECT COUNT(*) FROM growth_portfolios WHERE user_id=?', (user['id'],)).fetchone()[0]
                if count >= permissions['portfolioLimit']:
                    raise membership.AppError('This plan supports one portfolio. Update your existing portfolio or choose Pro for multiple portfolios.', 403, 'upgrade_required', 'pro')
                db.execute('INSERT INTO growth_portfolios VALUES(?,?,?,?,?,?,?)', (secrets.token_hex(16), user['id'], name, json.dumps(holdings), 'demo sync' if action == 'demo_sync' else 'manual import', now, now))
            else:
                db.execute('UPDATE growth_portfolios SET name=?,holdings=?,source=?,updated_at=? WHERE id=? AND user_id=?', (name, json.dumps(holdings), 'demo sync' if action == 'demo_sync' else 'manual import', now, existing['id'], user['id']))
            message = 'Demo portfolio synced locally; no broker was connected.' if action == 'demo_sync' else 'Portfolio imported. Valuations use mock market prices.'
        elif action == 'portfolio_remove':
            membership.require_plan(user, 'plus')
            row = _owned(db, 'growth_portfolios', user, body.get('id'))
            db.execute('DELETE FROM growth_portfolios WHERE id=? AND user_id=?', (row['id'], user['id']))
            message = 'Portfolio removed.'
        elif action == 'report_generate':
            template, content = _report(user, body, db)
            count = db.execute('SELECT COUNT(*) FROM growth_reports WHERE user_id=?', (user['id'],)).fetchone()[0]
            if count >= 100:
                raise membership.AppError('Delete a saved report before generating more.', 409, 'report_limit')
            title = _text(body.get('title'), 'report title', 120, template['name'])
            db.execute('INSERT INTO growth_reports VALUES(?,?,?,?,?,?)', (secrets.token_hex(16), user['id'], title, template['id'], json.dumps(content), now))
            message = 'Structured mock research saved to your account.'
        elif action == 'report_delete':
            membership.require_plan(user, 'plus')
            row = _owned(db, 'growth_reports', user, body.get('id'))
            db.execute('DELETE FROM growth_reports WHERE id=? AND user_id=?', (row['id'], user['id']))
            message = 'Report deleted.'
        elif action == 'alert_create':
            membership.require_plan(user, 'plus')
            a = _asset(body.get('marketCode'), body.get('symbol'))
            direction = body.get('direction')
            if direction not in ('above', 'below'):
                raise membership.AppError('Choose an above or below price condition.')
            threshold = _number(body.get('threshold'), 'price threshold', minimum=0.00000001)
            if db.execute('SELECT COUNT(*) FROM growth_alerts WHERE user_id=?', (user['id'],)).fetchone()[0] >= 100:
                raise membership.AppError('Delete an alert before creating more.', 409, 'alert_limit')
            db.execute('INSERT INTO growth_alerts VALUES(?,?,?,?,?,?,?)', (secrets.token_hex(16), user['id'], a['marketCode'], a['symbol'], direction, threshold, now))
            message = 'In-app alert created against the mock snapshot.'
        elif action == 'alert_remove':
            membership.require_plan(user, 'plus')
            row = _owned(db, 'growth_alerts', user, body.get('id'))
            db.execute('DELETE FROM growth_alerts WHERE id=? AND user_id=?', (row['id'], user['id']))
            message = 'Alert removed.'
        elif action == 'profile_update':
            code = body.get('marketCode')
            risk = body.get('riskProfile')
            horizon = body.get('horizon')
            if code not in BY_CODE or risk not in ('conservative', 'balanced', 'growth') or horizon not in ('short-term', 'long-term', 'retirement'):
                raise membership.AppError('Choose supported market, research style, and horizon settings.')
            db.execute('INSERT INTO growth_preferences VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET market_code=excluded.market_code,risk_profile=excluded.risk_profile,horizon=excluded.horizon', (user['id'], code, risk, horizon))
            message = 'Research preferences saved. Preferences do not change your subscription.'
        else:
            raise membership.AppError('Choose a supported workspace action.')
    return {'message': message, 'state': get_state(user)}


def export_report(user, report_id):
    user = _user(user)
    membership.require_plan(user, 'pro')
    with _database() as db:
        row = _owned(db, 'growth_reports', user, report_id)
        report = json.loads(row['content'])
    lines = ['# ' + row['title'], '', 'Sharebajar research report', 'Data: illustrative mock snapshot', '']
    if report.get('question'):
        lines += ['Research question: ' + report['question'], '']
    for section in report['sections']:
        lines += ['## ' + section['heading'], '', section['body'], '']
    for currency, values in report.get('totalsByCurrency', {}).items():
        lines += [currency + ' mock value: ' + format(values['value'], ',.2f') + '; cost: ' + format(values['cost'], ',.2f') + '; unrealized gain: ' + format(values['gain'], ',.2f'), '']
    if report.get('scenarios'):
        lines += ['## Illustrative scenarios', '', json.dumps(report['scenarios'], ensure_ascii=False, indent=2), '']
    if report.get('portfolios'):
        lines += ['## Portfolio comparison data', '', json.dumps(report['portfolios'], ensure_ascii=False, indent=2), '']
    lines += [report['limitations'], '']
    return {'filename': 'sharebajar-research-' + row['id'] + '.md', 'content': '\n'.join(lines), 'mimeType': 'text/markdown; charset=utf-8'}


def render_workspace(user=None, view='overview'):
    if view not in VIEWS:
        view = 'overview'
    esc = lambda value: html.escape(str(value), quote=True)
    nav = ''.join('<a href="/workspace' + ('/' + item if item != 'overview' else '') + '"' + (' aria-current="page"' if view == item else '') + '>' + esc({'overview': 'Overview', 'portfolio': 'Portfolio & risk', 'research': 'AI research', 'forecast': 'Scenarios', 'reports': 'Saved reports'}.get(item, item.title())) + '</a>' for item in VIEWS)
    titles = {'overview': 'Your financial research workspace', 'watchlist': 'Assets you are following', 'portfolio': 'Portfolio valuation & risk', 'research': 'AI research assistant', 'forecast': 'Explore portfolio scenarios', 'reports': 'Your saved research', 'templates': 'Financial research templates', 'alerts': 'Your market alerts', 'settings': 'Research preferences'}
    return '<link rel="stylesheet" href="/growth-workspace.css"><section class="growth-workspace" data-workspace-view="' + esc(view) + '"><div class="gw-heading"><div><span class="eyebrow">SHAREBAJAR / PRIVATE WORKSPACE</span><h1>' + titles[view] + '</h1><p>Research markets, understand exposure, and organize your next investment questions.</p></div><a class="gw-button" href="/markets">Explore markets →</a></div><nav class="gw-nav" aria-label="Research workspace">' + nav + '</nav><div class="gw-data-notice"><span class="gw-dot"></span><strong>Mock research environment</strong><span>Illustrative prices · Structured analysis · Account-owned data</span></div><p id="gw-status" role="status" aria-live="polite"></p><div id="gw-content"><p class="gw-loading">Opening your workspace…</p></div></section><script type="module" src="/growth-workspace.js"></script>'

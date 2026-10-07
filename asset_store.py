"""Canonical asset registry, provider instruments and transaction-safe sync snapshots."""
import json,math,re,time
from datetime import datetime,timezone
from market_db import database,event,encode,now,CLASSES
from membership import AppError
from asset_seed import REGIONS
FIELDS=['id','symbol','name','type','country','region','exchange','currency']
UNKNOWN={'','Provider directory','Unknown'}

def validate_id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9^=._:\-]{1,80}',value):raise AppError('Choose a valid asset identifier.')
    return value

def row_asset(db,row):
    a={k:row[k] for k in FIELDS};a.update(metadataSource=row['source'],status=row['status'],revision=row['revision'],updatedAt=row['updated_at'])
    a['providers']=[dict(provider=m['provider_id'],symbol=m['provider_symbol'],capabilities=json.loads(m['capabilities'])) for m in db.execute('SELECT * FROM provider_instruments WHERE asset_id=? ORDER BY provider_id',(a['id'],))]
    return a

def get_asset(identifier):
    validate_id(identifier)
    with database() as db:
        row=db.execute('SELECT * FROM assets WHERE id=?',(identifier,)).fetchone()
        return row_asset(db,row) if row else None

def asset_rows(db,query='',kind='',country='',exchange='',limit=500,offset=0):
    where=['status=?'];params=['active']
    for key,value in [('type',kind),('country',country),('exchange',exchange)]:
        if value:where.append(key+'=?');params.append(value)
    if query:
        term='%'+query.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        where.append("(name LIKE ? ESCAPE '\\' OR symbol LIKE ? ESCAPE '\\' OR country LIKE ? ESCAPE '\\')");params.extend([term]*3)
    condition=' AND '.join(where)
    total=db.execute('SELECT COUNT(*) FROM assets WHERE '+condition,params).fetchone()[0]
    rows=db.execute('SELECT * FROM assets WHERE '+condition+' ORDER BY type,name,id LIMIT ? OFFSET ?',params+[limit,offset]).fetchall()
    return [row_asset(db,row) for row in rows],total

def list_assets(query='',kind='',country='',exchange='',limit=500,offset=0):
    with database() as db:return asset_rows(db,query,kind,country,exchange,limit,offset)[0]

def upsert_assets(items,provider):
    if provider not in ('yahoo','coingecko','internal'):raise ValueError('Unsupported asset provider')
    normalized=[]
    for item in items:
        identifier=validate_id(item.get('id'));a={k:str(item.get(k) or '')[:200] for k in FIELDS};a['id']=identifier
        if a['type'] not in CLASSES or not a['name'] or not a['symbol']:raise AppError('Invalid provider asset metadata.')
        if provider=='coingecko' and (not identifier.startswith('crypto:') or a['type']!='Crypto'):raise AppError('Invalid crypto identifier.')
        if provider=='internal' and (identifier!='cash:'+a['currency'] or not re.fullmatch('[A-Z]{3}',a['currency'])):raise AppError('Invalid cash identifier.')
        normalized.append(a)
    results=[]
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        for a in normalized:
            old=db.execute('SELECT * FROM assets WHERE id=?',(a['id'],)).fetchone()
            if old:
                if old['type']!=a['type']:raise AppError('Provider asset class conflicts with the canonical asset.')
                # Discovery placeholders must not erase curated country/currency/exchange metadata.
                for field in ['country','currency','region','exchange','name']:
                    if a[field] in UNKNOWN or field=='region' and a[field]=='World' and old[field] not in UNKNOWN:a[field]=old[field]
                if old['source']=='seed':
                    for field in ['country','region','exchange','name']:
                        if old[field] not in UNKNOWN:a[field]=old[field]
            symbol=a['id'][7:] if provider=='coingecko' else a['currency'] if provider=='internal' else a['id']
            capabilities=['quote'] if provider=='internal' else ['quote','history']
            existing_map=db.execute('SELECT * FROM provider_instruments WHERE asset_id=? AND provider_id=?',(a['id'],provider)).fetchone()
            new_map=not existing_map or existing_map['provider_symbol']!=symbol
            changed=not old or any(old[k]!=a[k] for k in FIELDS) or new_map
            revision=event(db,'asset',a['id']) if changed else old['revision']
            source=old['source'] if old and old['source']=='seed' else provider
            updated=now() if changed else old['updated_at']
            db.execute('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET symbol=excluded.symbol,name=excluded.name,type=excluded.type,country=excluded.country,region=excluded.region,exchange=excluded.exchange,currency=excluded.currency,revision=excluded.revision,updated_at=excluded.updated_at',(*(a[k] for k in FIELDS),source,'active',revision,updated))
            db.execute('INSERT INTO provider_instruments VALUES(?,?,?,?) ON CONFLICT(asset_id,provider_id) DO UPDATE SET provider_symbol=excluded.provider_symbol,capabilities=excluded.capabilities',(a['id'],provider,symbol,encode(capabilities)))
            if a['type']=='Stocks' and a['exchange'] in ['NASDAQ','NasdaqGS','NasdaqGM','NasdaqCM','NYSE','NYSE American']:
                db.execute('INSERT OR IGNORE INTO provider_instruments VALUES(?,?,?,?)',(a['id'],'alphavantage',a['symbol'],encode(['fundamentals'])))
            results.append(row_asset(db,db.execute('SELECT * FROM assets WHERE id=?',(a['id'],)).fetchone()))
    return results

def update_currency(identifier,currency):
    if not isinstance(currency,str) or not re.fullmatch('[A-Za-z]{3}',currency):return
    with database() as db:
        db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT currency FROM assets WHERE id=?',(identifier,)).fetchone()
        if old and old['currency']!=currency:
            revision=event(db,'asset',identifier);db.execute('UPDATE assets SET currency=?,revision=?,updated_at=? WHERE id=?',(currency,revision,now(),identifier))

def mapping(asset,capability):
    return next((m for m in asset.get('providers',[]) if capability in m['capabilities']),None)

def snapshot(limit=500,offset=0,**filters):
    with database() as db:
        db.execute('BEGIN');items,total=asset_rows(db,limit=limit,offset=offset,**filters);head=db.execute('SELECT COALESCE(MAX(version),0) FROM changes').fetchone()[0]
        database_id=db.execute("SELECT value FROM metadata WHERE key='database_id'").fetchone()[0]
        return dict(assets=items,total=total,limit=limit,offset=offset,hasMore=offset+len(items)<total,regions=REGIONS,classes=CLASSES,cursor=head,databaseId=database_id,syncedAt=now())

def quote_from_row(row):
    q=json.loads(row['payload']);stale=time.time()>=row['expires_at'] or bool(row['last_error'])
    q.update(revision=row['revision'],fetchedAt=datetime.fromtimestamp(row['fetched_at'],timezone.utc).isoformat(),expiresAt=datetime.fromtimestamp(row['expires_at'],timezone.utc).isoformat(),stale=stale)
    if stale:q.update(marketStatus=q.get('status'),status='Stale cached data',warning=row['last_error'] or 'The cached quote has expired; refresh to retrieve provider data.')
    return q

def get_quote(identifier,period='1d',allow_expired=False):
    with database() as db:row=db.execute('SELECT * FROM quotes WHERE asset_id=? AND period=?',(identifier,period)).fetchone()
    if not row or not allow_expired and (time.time()>=row['expires_at'] or row['last_error']):return None
    return quote_from_row(row)

def put_quote(identifier,period,payload,ttl):
    timestamp=time.time();data=dict(payload,id=identifier);encoded=encode(data)
    with database() as db:
        db.execute('BEGIN IMMEDIATE');revision=event(db,'quote',identifier)
        db.execute('INSERT INTO quotes VALUES(?,?,?,?,?,?,NULL,?) ON CONFLICT(asset_id,period) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,revision=excluded.revision,last_error=NULL,last_attempt_at=excluded.last_attempt_at',(identifier,period,encoded,timestamp,timestamp+ttl,revision,timestamp))
        row=db.execute('SELECT * FROM quotes WHERE asset_id=? AND period=?',(identifier,period)).fetchone()
        return quote_from_row(row)

def quote_failure(identifier,period,message):
    with database() as db:
        db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT last_error FROM quotes WHERE asset_id=? AND period=?',(identifier,period)).fetchone()
        if old:
            revision=event(db,'quote',identifier) if old['last_error']!=message else None
            db.execute('UPDATE quotes SET last_error=?,last_attempt_at=?,revision=COALESCE(?,revision) WHERE asset_id=? AND period=?',(message,time.time(),revision,identifier,period))

def put_dataset(identifier,kind,window,payload,ttl):
    with database() as db:db.execute('INSERT INTO datasets VALUES(?,?,?,?,?,?,?) ON CONFLICT(asset_id,kind,window) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at',(identifier,kind,window,encode(payload),time.time(),time.time()+ttl))

def get_dataset(identifier,kind,window):
    with database() as db:row=db.execute('SELECT payload,expires_at FROM datasets WHERE asset_id=? AND kind=? AND window=?',(identifier,kind,window)).fetchone()
    return json.loads(row['payload']) if row and time.time()<row['expires_at'] else None

def delta(since,limit=200,database_id=None):
    with database() as db:
        db.execute('BEGIN');identity=db.execute("SELECT value FROM metadata WHERE key='database_id'").fetchone()[0];head=db.execute('SELECT COALESCE(MAX(version),0) FROM changes').fetchone()[0]
        if since>head or database_id and database_id!=identity:return dict(resetRequired=True,databaseId=identity,cursor=head,assets=[],quotes=[],hasMore=False,syncedAt=now())
        events=db.execute('SELECT * FROM changes WHERE version>? AND version<=? ORDER BY version LIMIT ?',(since,head,limit)).fetchall();cursor=events[-1]['version'] if events else head
        ids=list(dict.fromkeys(e['asset_id'] for e in events));assets=[];quotes=[]
        for identifier in ids:
            row=db.execute('SELECT * FROM assets WHERE id=?',(identifier,)).fetchone()
            if row:assets.append(row_asset(db,row))
            q=db.execute("SELECT * FROM quotes WHERE asset_id=? AND period='1d'",(identifier,)).fetchone()
            if q:quotes.append(quote_from_row(q))
        return dict(resetRequired=False,databaseId=identity,cursor=cursor,assets=assets,quotes=quotes,hasMore=cursor<head,syncedAt=now())

def sync_status():
    with database() as db:
        providers=[]
        for p in db.execute('SELECT * FROM providers ORDER BY name'):
            providers.append(dict(id=p['id'],name=p['name'],apiBase=p['api_base'],configured=not p['key_env'] or bool(__import__('os').environ.get(p['key_env'])),lastAttemptAt=p['last_attempt_at'],lastSuccessAt=p['last_success_at'],error=p['last_error']))
        counts={r['type']:r['count'] for r in db.execute('SELECT type,COUNT(*) count FROM assets GROUP BY type')}
        return dict(databaseId=db.execute("SELECT value FROM metadata WHERE key='database_id'").fetchone()[0],cursor=db.execute('SELECT COALESCE(MAX(version),0) FROM changes').fetchone()[0],assetCount=sum(counts.values()),classes=[dict(name=c,count=counts.get(c,0)) for c in CLASSES],providers=providers,quotes=dict(cached=db.execute('SELECT COUNT(*) FROM quotes').fetchone()[0],fresh=db.execute('SELECT COUNT(*) FROM quotes WHERE expires_at>? AND last_error IS NULL',(time.time(),)).fetchone()[0]),jobs=[dict(r) for r in db.execute('SELECT * FROM sync_jobs ORDER BY started_at DESC LIMIT 5')],syncedAt=now())

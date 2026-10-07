"""Central market database. No credentials or user portfolio positions are stored here."""
from contextlib import contextmanager
from datetime import datetime,timezone
import hashlib,json,os,sqlite3,threading,time,uuid
from pathlib import Path
from asset_seed import ASSETS as SEED

CLASSES=['Stocks','ETFs','Indexes','Commodities','Forex','Crypto','Cash']
PROVIDERS=[('yahoo','Yahoo Finance','https://query1.finance.yahoo.com',None),('coingecko','CoinGecko','https://api.coingecko.com/api/v3',None),('alphavantage','Alpha Vantage','https://www.alphavantage.co','ALPHAVANTAGE_API_KEY'),('frankfurter','Frankfurter','https://api.frankfurter.dev',None),('news','Google News RSS','https://news.google.com/rss',None),('internal','Cash face value','',None)]
_lock=threading.RLock();_initialized=set()
def now():return datetime.now(timezone.utc).isoformat()
def path():return Path(os.environ.get('SHAREBAJAR_MARKET_DB') or str(Path(__file__).parent/'.data'/'market.sqlite')).resolve()
def encode(value):return json.dumps(value,allow_nan=False,separators=(',',':'),sort_keys=True)
SCHEMA='''
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS asset_classes(id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS providers(id TEXT PRIMARY KEY,name TEXT NOT NULL,api_base TEXT NOT NULL,key_env TEXT,last_attempt_at TEXT,last_success_at TEXT,last_error TEXT);
CREATE TABLE IF NOT EXISTS changes(version INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,asset_id TEXT NOT NULL,changed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,symbol TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL REFERENCES asset_classes(id),country TEXT NOT NULL,region TEXT NOT NULL,exchange TEXT NOT NULL,currency TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS asset_filters ON assets(type,country,exchange);
CREATE INDEX IF NOT EXISTS asset_symbol ON assets(symbol);
CREATE TABLE IF NOT EXISTS provider_instruments(asset_id TEXT NOT NULL REFERENCES assets(id),provider_id TEXT NOT NULL REFERENCES providers(id),provider_symbol TEXT NOT NULL,capabilities TEXT NOT NULL,PRIMARY KEY(asset_id,provider_id),UNIQUE(provider_id,provider_symbol));
CREATE TABLE IF NOT EXISTS quotes(asset_id TEXT NOT NULL REFERENCES assets(id),period TEXT NOT NULL,payload TEXT NOT NULL,fetched_at REAL NOT NULL,expires_at REAL NOT NULL,revision INTEGER NOT NULL,last_error TEXT,last_attempt_at REAL,PRIMARY KEY(asset_id,period));
CREATE TABLE IF NOT EXISTS datasets(asset_id TEXT NOT NULL REFERENCES assets(id),kind TEXT NOT NULL,window TEXT NOT NULL,payload TEXT NOT NULL,fetched_at REAL NOT NULL,expires_at REAL NOT NULL,PRIMARY KEY(asset_id,kind,window));
CREATE TABLE IF NOT EXISTS response_cache(request_key TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES providers(id),payload TEXT NOT NULL,fetched_at REAL NOT NULL,expires_at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS response_expiry ON response_cache(expires_at);
CREATE TABLE IF NOT EXISTS sync_jobs(id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,status TEXT NOT NULL,assets_seen INTEGER NOT NULL DEFAULT 0,error TEXT);
'''
def event(db,kind,identifier):return db.execute('INSERT INTO changes(kind,asset_id,changed_at) VALUES(?,?,?)',(kind,identifier,now())).lastrowid

def initialize(db):
    db.executescript(SCHEMA)
    db.execute('BEGIN IMMEDIATE')
    db.executemany('INSERT OR IGNORE INTO asset_classes VALUES(?)',[(c,) for c in CLASSES])
    db.executemany('INSERT OR IGNORE INTO providers(id,name,api_base,key_env) VALUES(?,?,?,?)',PROVIDERS)
    db.execute('INSERT OR IGNORE INTO metadata VALUES(?,?)',('database_id',str(uuid.uuid4())))
    seeds=SEED+[dict(id='crypto:'+i,symbol=s,name=n,type='Crypto',currency='USD',country='Global',region='World',exchange='CoinGecko') for i,s,n in [('bitcoin','BTC','Bitcoin'),('ethereum','ETH','Ethereum')]]
    seeds += [dict(id='cash:'+c,symbol=c,name=c+' Cash',type='Cash',currency=c,country='Cash',region='World',exchange='Cash') for c in ['USD','EUR','GBP','JPY','INR','NPR','CAD','AUD','CHF','CNY','HKD','SGD','KRW','NZD','BRL','ZAR']]
    for a in seeds:
        if db.execute('SELECT 1 FROM assets WHERE id=?',(a['id'],)).fetchone():continue
        revision=event(db,'asset',a['id'])
        db.execute('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(*(a[k] for k in ['id','symbol','name','type','country','region','exchange','currency']),'seed','active',revision,now()))
        # Explicit column list below is also used for subsequent ingestion.
    for a in seeds:
        provider='coingecko' if a['type']=='Crypto' else 'internal' if a['type']=='Cash' else 'yahoo'
        symbol=a['id'][7:] if provider=='coingecko' else a['id'][5:] if provider=='internal' else a['id']
        db.execute('INSERT OR IGNORE INTO provider_instruments VALUES(?,?,?,?)',(a['id'],provider,symbol,encode(['quote'] if provider=='internal' else ['quote','history'])))
        if a['type']=='Stocks' and a['exchange'] in ['NASDAQ','NYSE','NYSE American']:
            db.execute('INSERT OR IGNORE INTO provider_instruments VALUES(?,?,?,?)',(a['id'],'alphavantage',a['symbol'],encode(['fundamentals'])))
    db.execute('PRAGMA user_version=1');db.commit()

@contextmanager
def database():
    location=path();location.parent.mkdir(parents=True,exist_ok=True)
    with _lock:
        db=sqlite3.connect(location,timeout=15);db.row_factory=sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON');db.execute('PRAGMA busy_timeout=15000')
        if str(location) not in _initialized or db.execute('PRAGMA user_version').fetchone()[0]==0:
            try:initialize(db);_initialized.add(str(location))
            except Exception:db.rollback();db.close();raise
    try:
        yield db;db.commit()
    except Exception:db.rollback();raise
    finally:db.close()

def cache_key(url):return hashlib.sha256(url.encode()).hexdigest()
def cache_get(url,max_age,allow_expired=False):
    with database() as db:row=db.execute('SELECT * FROM response_cache WHERE request_key=?',(cache_key(url),)).fetchone()
    if row and (allow_expired or time.time()<min(row['expires_at'],row['fetched_at']+max_age)):return json.loads(row['payload'])
    return None

def cache_put(url,provider,data,ttl):
    payload=encode(data);timestamp=time.time()
    with database() as db:
        db.execute('INSERT INTO response_cache VALUES(?,?,?,?,?) ON CONFLICT(request_key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at',(cache_key(url),provider,payload,timestamp,timestamp+ttl))
        db.execute('UPDATE providers SET last_attempt_at=?,last_success_at=?,last_error=NULL WHERE id=?',(now(),now(),provider))
        db.execute('DELETE FROM response_cache WHERE expires_at<?',(timestamp-7*86400,))

def provider_failure(provider,message):
    with database() as db:db.execute('UPDATE providers SET last_attempt_at=?,last_error=? WHERE id=?',(now(),message,provider))

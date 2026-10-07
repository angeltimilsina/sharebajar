"""Account-owned financial experience drafts with explicit administrator publishing."""
import json,re,secrets,time
from membership import database,AppError

def admin(user):
    if not user:raise AppError('Sign in to access the internal page generator.',401,'unauthorized')
    if user.get('role')!='admin':raise AppError('Administrator access is required to generate or publish public research pages.',403,'admin_required')

def content_database():
    return database()
def schema(db):
    db.execute('CREATE TABLE IF NOT EXISTS financial_pages(id TEXT PRIMARY KEY,owner TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,created_at REAL NOT NULL)')

def create_draft(user,page):
    admin(user);identifier=secrets.token_hex(10)
    title=page.get('title','research');slug=re.sub('[^a-z0-9]+','-',title.lower()).strip('-')[:70]+'-'+identifier[:6]
    with database() as db:
        schema(db);db.execute('INSERT INTO financial_pages VALUES(?,?,?,?,?,?)',(identifier,user['id'],slug,json.dumps(page,allow_nan=False),'draft',time.time()))
    return dict(id=identifier,slug=slug,status='draft',page=page)

def list_drafts(user):
    admin(user)
    with database() as db:
        schema(db);rows=db.execute('SELECT * FROM financial_pages WHERE owner=? ORDER BY created_at DESC LIMIT 100',(user['id'],)).fetchall()
    return [dict(id=r['id'],slug=r['slug'],status=r['status'],title=json.loads(r['payload'])['title'],createdAt=r['created_at']) for r in rows]

def publish(user,identifier):
    admin(user)
    if not isinstance(identifier,str) or not re.fullmatch('[a-f0-9]{20}',identifier):raise AppError('Choose a valid draft.')
    with database() as db:
        schema(db);row=db.execute('SELECT * FROM financial_pages WHERE id=? AND owner=?',(identifier,user['id'])).fetchone()
        if not row:raise AppError('Draft not found.',404,'not_found')
        page=json.loads(row['payload'])
        if page.get('visibility')=='private':raise AppError('Private portfolio and investor pages cannot be published.',403,'private_page')
        db.execute('UPDATE financial_pages SET status=? WHERE id=?',('published',identifier))
    return dict(id=identifier,status='published',path='/research/generated/'+row['slug'])

def get_published(slug):
    if not isinstance(slug,str) or not re.fullmatch('[a-z0-9-]{1,90}',slug):return None
    with database() as db:
        schema(db);row=db.execute('SELECT payload FROM financial_pages WHERE slug=? AND status=?',(slug,'published')).fetchone()
    return json.loads(row['payload']) if row else None

def published_paths():
    with database() as db:
        schema(db);rows=db.execute('SELECT slug FROM financial_pages WHERE status=?',('published',)).fetchall()
    return ['/research/generated/'+r['slug'] for r in rows]

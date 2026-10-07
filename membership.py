"""Server-owned memberships, recovery, Google sign-in, and administrator access."""
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import re
import secrets
import smtplib
import sqlite3
import ssl
import time
import threading
from contextlib import contextmanager
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from email.message import EmailMessage
from email.utils import formatdate

_schema_lock=threading.Lock()

class AppError(Exception):
    def __init__(self,message,status=400,code='invalid_request',required_plan=None):
        super().__init__(message);self.status=status;self.code=code;self.required_plan=required_plan

@contextmanager
def database():
    with _schema_lock:
        path=Path(os.environ.get('SHAREBAJAR_ACCOUNT_DB') or str(Path(__file__).parent/'.data'/'accounts.sqlite'))
        path.parent.mkdir(parents=True,exist_ok=True)
        db=sqlite3.connect(path,timeout=10);db.row_factory=sqlite3.Row
        try:
            db.execute('PRAGMA foreign_keys=ON')
            db.executescript('''
            CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,salt TEXT NOT NULL,plan TEXT NOT NULL DEFAULT 'free',plan_expires REAL NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS usage(principal TEXT NOT NULL,window INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(principal,window));
            CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT NOT NULL,target_id TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL,created_at REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS research_conversations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,created_at REAL NOT NULL,updated_at REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS research_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES research_conversations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,payload TEXT NOT NULL,created_at REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS research_conversations_owner_updated ON research_conversations(user_id,updated_at DESC);
            CREATE INDEX IF NOT EXISTS research_messages_conversation_created ON research_messages(conversation_id,created_at);
            ''')
            columns={row['name'] for row in db.execute('PRAGMA table_info(users)')}
            migrations={
                'role':"TEXT NOT NULL DEFAULT 'user'",
                'disabled':'INTEGER NOT NULL DEFAULT 0',
                'auth_provider':"TEXT NOT NULL DEFAULT 'password'",
                'created_at':'REAL',
                'last_seen_at':'REAL',
            }
            for name,definition in migrations.items():
                if name not in columns:db.execute(f'ALTER TABLE users ADD COLUMN {name} {definition}')
            db.commit()
        except Exception:
            db.close()
            raise
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback();raise
    finally:db.close()

def password_hash(password,salt):
    return hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),600_000).hex()

def normalized_credentials(body):
    email=body.get('email');password=body.get('password')
    if not isinstance(email,str) or not re.fullmatch(r'[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{2,30}',email):
        raise AppError('Enter a valid email address.')
    if not isinstance(password,str) or not 12<=len(password)<=128:
        raise AppError('Use a password between 12 and 128 characters.')
    return email.lower(),password

def new_session(db,user_id):
    token=secrets.token_urlsafe(32)
    now=time.time()
    db.execute('DELETE FROM sessions WHERE expires<=?',(now,))
    db.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),user_id,now+86400))
    db.execute('UPDATE users SET last_seen_at=? WHERE id=?',(now,user_id))
    user=db.execute('SELECT * FROM users WHERE id=?',(user_id,)).fetchone()
    return dict(token=token,account=account_details(dict(user)))

def signup(body):
    email,password=normalized_credentials(body);salt=secrets.token_hex(16)
    with database() as db:
        try: db.execute('INSERT INTO users(id,email,password,salt,created_at,last_seen_at) VALUES(?,?,?,?,?,?)',(secrets.token_hex(16),email,password_hash(password,salt),salt,time.time(),time.time()))
        except sqlite3.IntegrityError as exc: raise AppError('Unable to create this account. Try signing in.',409) from exc
    return login(body)

def login(body):
    email,password=normalized_credentials(body)
    with database() as db:
        user=db.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()
        salt=user['salt'] if user else '00'*16
        candidate=password_hash(password,salt)
        if not user or user['disabled'] or not hmac.compare_digest(candidate,user['password']):raise AppError('Email or password is incorrect.',401,'unauthorized')
        return new_session(db,user['id'])

def authenticated_user(authorization):
    if not authorization:return None
    if not authorization.startswith('Bearer ') or len(authorization)>200:raise AppError('Sign in again to continue.',401,'unauthorized')
    digest=hashlib.sha256(authorization[7:].encode()).hexdigest()
    with database() as db:
        user=db.execute('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires>?',(digest,time.time())).fetchone()
        if user and user['disabled']:
            db.execute('DELETE FROM sessions WHERE token_hash=?',(digest,))
            user=None
    if not user:raise AppError('Your session expired. Sign in again.',401,'unauthorized')
    return dict(user)

def effective_plan(user):
    return user['plan'] if user and user['plan'] in ('plus','pro') and user['plan_expires']>time.time() else 'free'

def account_details(user):
    plan=effective_plan(user)
    smtp_username=os.environ.get('SHAREBAJAR_SMTP_USERNAME')
    smtp_password=os.environ.get('SHAREBAJAR_SMTP_PASSWORD')
    return dict(signedIn=bool(user),email=user['email'] if user else None,plan=plan,
                features={'portfolioAI':plan in ('plus','pro'),'assetAI':plan=='pro'},
                isAdmin=bool(user and user.get('role')=='admin'),
                aiConfigured=bool(os.environ.get('OPENAI_API_KEY')),fundamentalsConfigured=bool(os.environ.get('ALPHAVANTAGE_API_KEY')),
                googleConfigured=bool(os.environ.get('GOOGLE_CLIENT_ID') and os.environ.get('GOOGLE_CLIENT_SECRET')),
                passwordResetConfigured=bool(os.environ.get('SHAREBAJAR_SMTP_HOST') and os.environ.get('SHAREBAJAR_SMTP_FROM') and bool(smtp_username)==bool(smtp_password)))

def require_plan(user,required):
    if not user:raise AppError('Sign in to use AI analysis.',401,'unauthorized',required)
    if {'free':0,'plus':1,'pro':2}[effective_plan(user)]<{'plus':1,'pro':2}[required]:
        raise AppError(f'Upgrade to {required.title()} to unlock this AI analysis.',403,'upgrade_required',required)

def logout(authorization):
    if authorization and authorization.startswith('Bearer '):
        with database() as db:db.execute('DELETE FROM sessions WHERE token_hash=?',(hashlib.sha256(authorization[7:].encode()).hexdigest(),))

def reserve_usage(principal,limit,seconds=86400):
    window=int(time.time()//seconds)*seconds
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        count=db.execute('SELECT count FROM usage WHERE principal=? AND window=?',(principal,window)).fetchone()
        if count and count['count']>=limit:raise AppError('Request limit reached. Try again after the limit resets.',429,'rate_limited')
        db.execute('INSERT INTO usage VALUES(?,?,1) ON CONFLICT(principal,window) DO UPDATE SET count=count+1',(principal,window))
        db.execute('DELETE FROM usage WHERE window<?',(int(time.time())-3*86400,))

def normalize_email(email):
    if not isinstance(email,str) or not re.fullmatch(r'[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{2,30}',email):
        raise AppError('Enter a valid email address.')
    return email.lower()

def request_password_reset(email):
    email=normalize_email(email)
    reserve_usage('password-reset-address:'+hashlib.sha256(email.encode()).hexdigest(),3,3600)
    host=os.environ.get('SHAREBAJAR_SMTP_HOST')
    sender=os.environ.get('SHAREBAJAR_SMTP_FROM')
    username=os.environ.get('SHAREBAJAR_SMTP_USERNAME')
    password=os.environ.get('SHAREBAJAR_SMTP_PASSWORD')
    if not host or not sender or bool(username)!=bool(password):raise AppError('Password recovery is not configured on this server yet.',503,'email_not_configured')
    token=secrets.token_urlsafe(32);digest=hashlib.sha256(token.encode()).hexdigest();now=time.time()
    with database() as db:
        user=db.execute('SELECT id,email FROM users WHERE email=? AND disabled=0',(email,)).fetchone()
        if not user:return {'sent':True}
        db.execute('DELETE FROM password_resets WHERE user_id=?',(user['id'],))
        db.execute('INSERT INTO password_resets VALUES(?,?,?)',(digest,user['id'],now+3600))
    base=os.environ.get('SHAREBAJAR_PUBLIC_URL','http://localhost:3000').rstrip('/')
    message=EmailMessage()
    message['Subject']='Reset your ShareBajar password'
    message['From']=sender
    message['To']=email
    message['Date']=formatdate(localtime=False)
    message.set_content(f'Use this link within one hour to reset your ShareBajar password:\n\n{base}/#reset={token}\n\nIf you did not request this, you can ignore this email.')
    try:
        port=int(os.environ.get('SHAREBAJAR_SMTP_PORT','587'))
        if port==465:
            smtp=smtplib.SMTP_SSL(host,port,timeout=15,context=ssl.create_default_context())
        else:
            smtp=smtplib.SMTP(host,port,timeout=15)
        with smtp:
            if port!=465:smtp.starttls(context=ssl.create_default_context())
            if username and password:smtp.login(username,password)
            smtp.send_message(message)
    except (OSError,smtplib.SMTPException,ValueError) as exc:
        with database() as db:db.execute('DELETE FROM password_resets WHERE token_hash=?',(digest,))
        logging.getLogger(__name__).error('Password reset email delivery failed (%s).',type(exc).__name__)
    return {'sent':True}

def reset_password(body):
    token=body.get('token');password=body.get('password')
    if not isinstance(token,str) or not 32<=len(token)<=128:raise AppError('This password reset link is invalid or expired.',400,'invalid_reset')
    if not isinstance(password,str) or not 12<=len(password)<=128:raise AppError('Use a password between 12 and 128 characters.')
    digest=hashlib.sha256(token.encode()).hexdigest();now=time.time();salt=secrets.token_hex(16)
    with database() as db:
        reset=db.execute('SELECT user_id FROM password_resets WHERE token_hash=? AND expires>?',(digest,now)).fetchone()
        if not reset:raise AppError('This password reset link is invalid or expired.',400,'invalid_reset')
        user=db.execute('SELECT auth_provider FROM users WHERE id=? AND disabled=0',(reset['user_id'],)).fetchone()
        if not user:raise AppError('This password reset link is invalid or expired.',400,'invalid_reset')
        providers=set(user['auth_provider'].split(','))
        providers.add('password')
        db.execute('UPDATE users SET password=?,salt=?,auth_provider=? WHERE id=?',(password_hash(password,salt),salt,','.join(sorted(providers)),reset['user_id']))
        db.execute('DELETE FROM password_resets WHERE user_id=?',(reset['user_id'],))
        db.execute('DELETE FROM sessions WHERE user_id=?',(reset['user_id'],))
    return {'reset':True}

def google_configuration():
    client_id=os.environ.get('GOOGLE_CLIENT_ID')
    client_secret=os.environ.get('GOOGLE_CLIENT_SECRET')
    if not client_id or not client_secret:raise AppError('Google sign-in is not configured on this server yet.',503,'google_not_configured')
    base=os.environ.get('SHAREBAJAR_PUBLIC_URL','http://localhost:3000').rstrip('/')
    redirect_uri=os.environ.get('GOOGLE_REDIRECT_URI') or base+'/api/auth/google/callback'
    return client_id,client_secret,redirect_uri

def google_authorization_url(state):
    client_id,_,redirect_uri=google_configuration()
    return 'https://accounts.google.com/o/oauth2/v2/auth?'+urlencode({
        'client_id':client_id,'redirect_uri':redirect_uri,'response_type':'code',
        'scope':'openid email profile','state':state,'prompt':'select_account',
    })

def google_login(code,state,cookie_state):
    if not isinstance(code,str) or not 1<=len(code)<=4096 or not isinstance(state,str) or not isinstance(cookie_state,str):
        raise AppError('Google sign-in could not be verified.',400,'invalid_oauth')
    if not state or not cookie_state or not hmac.compare_digest(state,cookie_state):raise AppError('Google sign-in could not be verified.',400,'invalid_oauth')
    client_id,client_secret,redirect_uri=google_configuration()
    try:
        payload=urlencode({'code':code,'client_id':client_id,'client_secret':client_secret,'redirect_uri':redirect_uri,'grant_type':'authorization_code'}).encode()
        request=Request('https://oauth2.googleapis.com/token',data=payload,headers={'Content-Type':'application/x-www-form-urlencoded'})
        with urlopen(request,timeout=12) as response:tokens=json.loads(response.read(65536))
        access_token=tokens.get('access_token')
        if not isinstance(access_token,str) or not access_token:raise ValueError('Missing access token')
        request=Request('https://openidconnect.googleapis.com/v1/userinfo',headers={'Authorization':'Bearer '+access_token})
        with urlopen(request,timeout=12) as response:profile=json.loads(response.read(65536))
        email=normalize_email(profile.get('email'))
        if profile.get('email_verified') is not True:raise AppError('Use a Google account with a verified email address.',403,'unverified_email')
    except AppError:raise
    except (HTTPError,URLError,TimeoutError,OSError,ValueError,TypeError,json.JSONDecodeError) as exc:
        raise AppError('Google sign-in could not be completed. Try again.',502,'google_auth_failed') from exc
    now=time.time()
    with database() as db:
        user=db.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()
        if user and user['disabled']:raise AppError('This account is disabled. Contact support.',403,'account_disabled')
        if user:
            providers=set(user['auth_provider'].split(','));providers.add('google')
            db.execute('UPDATE users SET auth_provider=? WHERE id=?',(','.join(sorted(providers)),user['id']))
            return new_session(db,user['id'])
        salt=secrets.token_hex(16)
        user_id=secrets.token_hex(16)
        db.execute('INSERT INTO users(id,email,password,salt,auth_provider,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)',
                   (user_id,email,password_hash(secrets.token_urlsafe(48),salt),salt,'google',now,now))
        return new_session(db,user_id)

def require_admin(user):
    if not user:raise AppError('Sign in to access administrator tools.',401,'unauthorized')
    if user.get('role')!='admin':raise AppError('Administrator access is required.',403,'admin_required')
    return user

def list_users(admin,query='',limit=100,offset=0):
    require_admin(admin)
    if not isinstance(query,str) or len(query)>100:raise AppError('Invalid search query.')
    limit=max(1,min(100,int(limit)));offset=max(0,int(offset))
    search='%'+query.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
    with database() as db:
        total=db.execute("SELECT COUNT(*) FROM users WHERE email LIKE ? ESCAPE '\\'",(search,)).fetchone()[0]
        rows=db.execute("SELECT id,email,plan,plan_expires,role,disabled,auth_provider,created_at,last_seen_at FROM users WHERE email LIKE ? ESCAPE '\\' ORDER BY created_at DESC,email LIMIT ? OFFSET ?",(search,limit,offset)).fetchall()
    users=[dict(row) for row in rows]
    for user in users:user['plan']=effective_plan(user)
    return {'users':users,'total':total,'limit':limit,'offset':offset}

def manage_user(admin,body):
    require_admin(admin)
    user_id=body.get('userId')
    action=body.get('action')
    if not isinstance(user_id,str) or not 1<=len(user_id)<=100:raise AppError('Select a valid user.')
    if user_id==admin['id']:raise AppError('You cannot change your own administrator account here.',400,'self_management_denied')
    now=time.time()
    with database() as db:
        target=db.execute('SELECT id,email,role,disabled FROM users WHERE id=?',(user_id,)).fetchone()
        if not target:raise AppError('User not found.',404,'user_not_found')
        if action=='plan':
            plan=body.get('plan');days=body.get('days')
            if plan not in ('free','plus','pro') or isinstance(days,bool) or not isinstance(days,int) or not 1<=days<=366:
                raise AppError('Choose a valid plan duration.')
            db.execute('UPDATE users SET plan=?,plan_expires=? WHERE id=?',(plan,now+days*86400,user_id))
            details={'plan':plan,'days':days}
        elif action=='status':
            disabled=body.get('disabled')
            if not isinstance(disabled,bool):raise AppError('Choose a valid account status.')
            if disabled and target['role']=='admin':
                active=db.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0").fetchone()[0]
                if active<=1:raise AppError('The last active administrator cannot be disabled.',409,'last_admin')
            db.execute('UPDATE users SET disabled=? WHERE id=?',(int(disabled),user_id))
            if disabled:
                db.execute('DELETE FROM sessions WHERE user_id=?',(user_id,))
                db.execute('DELETE FROM password_resets WHERE user_id=?',(user_id,))
            details={'disabled':disabled}
        else:raise AppError('Choose a supported account action.')
        db.execute('INSERT INTO admin_audit(actor_id,target_id,action,details,created_at) VALUES(?,?,?,?,?)',
                   (admin['id'],user_id,action,json.dumps(details,sort_keys=True),now))
    return {'updated':True}

def set_plan(email,plan,days):
    if plan not in ('free','plus','pro') or not 1<=days<=366:raise ValueError('Invalid membership')
    with database() as db:
        result=db.execute('UPDATE users SET plan=?,plan_expires=? WHERE email=?',(plan,time.time()+days*86400,email.lower()))
        if result.rowcount!=1:raise ValueError('Account not found. Create the account in the app first.')

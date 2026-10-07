import json
import os
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import membership as m


class MembershipTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{
            'SHAREBAJAR_ACCOUNT_DB':self.temp.name+'/accounts.sqlite',
            'SHAREBAJAR_PUBLIC_URL':'https://sharebajar.example',
            'SHAREBAJAR_SMTP_HOST':'smtp.example',
            'SHAREBAJAR_SMTP_FROM':'ShareBajar <noreply@example.test>',
        },clear=False)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def create_user(self,email='member@example.test'):
        return m.signup({'email':email,'password':'a-long-test-password'})

    def test_legacy_account_database_is_migrated_without_losing_users(self):
        path=os.environ['SHAREBAJAR_ACCOUNT_DB']
        salt='12'*16
        db=sqlite3.connect(path)
        try:
            db.execute('CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,salt TEXT NOT NULL,plan TEXT NOT NULL DEFAULT "free",plan_expires REAL NOT NULL DEFAULT 0)')
            db.execute('INSERT INTO users(id,email,password,salt) VALUES(?,?,?,?)',('legacy-id','legacy@example.test',m.password_hash('a-long-test-password',salt),salt))
            db.commit()
        finally:
            db.close()
        auth=m.login({'email':'legacy@example.test','password':'a-long-test-password'})
        self.assertEqual(auth['account']['email'],'legacy@example.test')
        with m.database() as db:
            user=db.execute('SELECT role,disabled,auth_provider,created_at,last_seen_at FROM users WHERE id=?',('legacy-id',)).fetchone()
            self.assertEqual((user['role'],user['disabled'],user['auth_provider']),('user',0,'password'))
            self.assertIsNone(user['created_at'])
            self.assertGreater(user['last_seen_at'],0)

    def test_password_reset_is_single_use_and_revokes_existing_sessions(self):
        auth=self.create_user()
        user=m.authenticated_user('Bearer '+auth['token'])
        sent=[]
        with patch('membership.smtplib.SMTP') as smtp_type:
            smtp=smtp_type.return_value
            smtp.send_message.side_effect=lambda message:sent.append(message.get_content())
            self.assertEqual(m.request_password_reset('member@example.test'),{'sent':True})
        self.assertIn('https://sharebajar.example/#reset=',sent[0])
        token=sent[0].split('#reset=')[1].splitlines()[0]
        self.assertEqual(m.reset_password({'token':token,'password':'an-even-longer-password'}),{'reset':True})
        with self.assertRaises(m.AppError):
            m.authenticated_user('Bearer '+auth['token'])
        self.assertEqual(m.login({'email':'member@example.test','password':'an-even-longer-password'})['account']['email'],'member@example.test')
        with self.assertRaises(m.AppError):
            m.reset_password({'token':token,'password':'another-long-password'})

    def test_password_reset_response_does_not_disclose_unknown_accounts(self):
        self.create_user()
        with patch('membership.smtplib.SMTP') as smtp_type:
            smtp=smtp_type.return_value.__enter__.return_value
            self.assertEqual(m.request_password_reset('unknown@example.test'),{'sent':True})
            smtp.send_message.assert_not_called()

    def test_password_reset_delivery_failure_keeps_response_uniform_and_logs_failure(self):
        self.create_user()
        with patch('membership.smtplib.SMTP',side_effect=OSError('mail relay unavailable')):
            with self.assertLogs('membership',level='ERROR') as logs:
                self.assertEqual(m.request_password_reset('member@example.test'),{'sent':True})
        self.assertIn('Password reset email delivery failed',logs.output[0])
        self.assertNotIn('member@example.test',logs.output[0])
        self.assertEqual(m.request_password_reset('unknown@example.test'),{'sent':True})

    def test_google_signin_requires_matching_state_and_links_verified_accounts(self):
        auth=self.create_user()
        with self.assertRaises(m.AppError):
            m.google_login('authorization-code','state-a','state-b')
        self.assertEqual(m.authenticated_user('Bearer '+auth['token'])['email'],'member@example.test')
        with patch.dict(os.environ,{'GOOGLE_CLIENT_ID':'client-id','GOOGLE_CLIENT_SECRET':'client-secret'}):
            token_response=MagicMock()
            token_response.__enter__.return_value.read.return_value=json.dumps({'access_token':'google-access-token'}).encode()
            profile_response=MagicMock()
            profile_response.__enter__.return_value.read.return_value=json.dumps({'email':'member@example.test','email_verified':True}).encode()
            with patch('membership.urlopen',side_effect=[token_response,profile_response]):
                google=m.google_login('authorization-code','same-state','same-state')
        self.assertEqual(google['account']['email'],'member@example.test')
        with m.database() as db:
            user=db.execute('SELECT auth_provider FROM users WHERE email=?',('member@example.test',)).fetchone()
            self.assertEqual(user['auth_provider'],'google,password')

    def test_google_signin_rejects_missing_state_before_contacting_google(self):
        with patch('membership.urlopen') as provider:
            with self.assertRaises(m.AppError) as error:
                m.google_login('authorization-code','','')
            self.assertEqual(error.exception.code,'invalid_oauth')
            provider.assert_not_called()

    def test_google_new_account_requires_verified_email(self):
        with patch.dict(os.environ,{'GOOGLE_CLIENT_ID':'client-id','GOOGLE_CLIENT_SECRET':'client-secret'}):
            token_response=MagicMock()
            token_response.__enter__.return_value.read.return_value=json.dumps({'access_token':'google-access-token'}).encode()
            profile_response=MagicMock()
            profile_response.__enter__.return_value.read.return_value=json.dumps({'email':'member@example.test','email_verified':False}).encode()
            with patch('membership.urlopen',side_effect=[token_response,profile_response]):
                with self.assertRaises(m.AppError):
                    m.google_login('authorization-code','same-state','same-state')
        with m.database() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0],0)

    def test_admin_management_is_authorized_audited_and_hides_credentials(self):
        owner=self.create_user('owner@example.test')
        target=self.create_user('target@example.test')
        with m.database() as db:
            db.execute("UPDATE users SET role='admin' WHERE email='owner@example.test'")
        admin=m.authenticated_user('Bearer '+owner['token'])
        with self.assertRaises(m.AppError):
            m.list_users(m.authenticated_user('Bearer '+target['token']))
        listing=m.list_users(admin)
        member=next(user for user in listing['users'] if user['email']=='target@example.test')
        self.assertNotIn('password',member)
        self.assertNotIn('salt',member)
        self.assertNotIn('session',member)
        m.manage_user(admin,{'userId':member['id'],'action':'plan','plan':'pro','days':30})
        m.manage_user(admin,{'userId':member['id'],'action':'status','disabled':True})
        with self.assertRaises(m.AppError):
            m.authenticated_user('Bearer '+target['token'])
        with m.database() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM admin_audit').fetchone()[0],2)

    def test_admin_cannot_disable_own_account(self):
        auth=self.create_user('owner@example.test')
        with m.database() as db:
            db.execute("UPDATE users SET role='admin' WHERE email='owner@example.test'")
        admin=m.authenticated_user('Bearer '+auth['token'])
        with self.assertRaises(m.AppError) as error:
            m.manage_user(admin,{'userId':admin['id'],'action':'status','disabled':True})
        self.assertEqual(error.exception.code,'self_management_denied')

    def test_admin_http_routes_require_role_and_expose_only_safe_user_fields(self):
        from manage_users import promote_admin
        from server import Handler

        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        origin='http://127.0.0.1:'+str(server.server_port)

        def request(path,token=None,body=None):
            headers={}
            data=None
            if body is not None:
                headers['Content-Type']='application/json'
                data=json.dumps(body).encode()
            if token:headers['Authorization']='Bearer '+token
            return urlopen(Request(origin+path,data=data,headers=headers),timeout=5)

        try:
            with self.assertRaises(HTTPError) as error:request('/api/research',body={'template':'snapshot','assets':['AAPL']})
            self.assertEqual(error.exception.code,401)
            with patch('server.market_news',return_value={'articles':[]}):
                with request('/api/news') as response:self.assertEqual(response.status,200)
            with self.assertRaises(HTTPError) as error:request('/api/admin/users')
            self.assertEqual(error.exception.code,401)
            with request('/api/auth/signup',body={'email':'admin@example.test','password':'a-long-test-password'}) as response:
                admin_auth=json.load(response)
            with request('/api/auth/signup',body={'email':'member@example.test','password':'a-long-test-password'}) as response:
                member_auth=json.load(response)
            with self.assertRaises(HTTPError) as error:request('/api/admin/users',admin_auth['token'])
            self.assertEqual(error.exception.code,403)
            promote_admin('admin@example.test')
            with request('/api/admin/users',admin_auth['token']) as response:
                data=json.load(response)
            row=next(user for user in data['users'] if user['email']=='member@example.test')
            self.assertNotIn('password',row)
            self.assertNotIn('salt',row)
            with request('/api/admin/users/manage',admin_auth['token'],{'userId':row['id'],'action':'status','disabled':True}) as response:
                self.assertEqual(json.load(response),{'updated':True})
            with self.assertRaises(HTTPError) as error:request('/api/admin/users',member_auth['token'])
            self.assertEqual(error.exception.code,401)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__=='__main__':
    unittest.main()

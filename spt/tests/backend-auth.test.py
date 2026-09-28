"""Private app-auth component tests; no provider, live identity or public bind."""
import importlib.util
import io
import json
from email.message import Message
from http.cookies import SimpleCookie
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('spt_backend', ROOT / 'scripts/spt-backend.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class BackendAuthTests(unittest.TestCase):
    def setUp(self):
        base = ROOT / '.sites-runtime/backend-private/tests'
        base.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=base)
        self.store = backend.AuthStore(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def response(self, token, now, path='/auth/status', readiness=None, expected_status=200):
        # Execute the real gateway handler with in-memory HTTP I/O, no listener.
        handler = object.__new__(backend.handler_for(self.store, 'https://spt.example', 4173, 'SYNTHETIC-INTERNAL', readiness=readiness))
        handler.headers = Message()
        handler.headers['Host'] = 'spt.example'
        handler.headers['Cookie'] = backend.COOKIE + '=' + token
        handler.command, handler.path = 'GET', path
        handler.rfile, handler.wfile = io.BytesIO(), io.BytesIO()
        status, headers = [], {}
        handler.send_response = status.append
        handler.send_header = lambda name, value: headers.update({name: value})
        handler.end_headers = lambda: None
        with patch.object(backend.time, 'time', return_value=now):
            handler.handle_request()
        self.assertEqual(status, [expected_status])
        return headers

    def request(self, path, *, method='GET', origin=backend.NATIVE_ORIGIN, authorization=None, cookie=None, body=b'', extra=None, now=100):
        handler = object.__new__(backend.handler_for(self.store, 'https://spt.example', 4173, 'SYNTHETIC-INTERNAL'))
        handler.headers = Message()
        handler.headers['Host'] = 'spt.example'
        if origin is not None:
            handler.headers['Origin'] = origin
        if authorization is not None:
            handler.headers['Authorization'] = authorization
        if cookie is not None:
            handler.headers['Cookie'] = cookie
        if body:
            handler.headers['Content-Length'] = str(len(body))
        for name, value in (extra or {}).items():
            handler.headers[name] = value
        handler.command, handler.path = method, path
        handler.rfile, handler.wfile = io.BytesIO(body), io.BytesIO()
        statuses, headers = [], {}
        handler.send_response = statuses.append
        handler.send_header = lambda name, value: headers.update({name: value})
        handler.end_headers = lambda: None
        with patch.object(backend.time, 'time', return_value=now):
            handler.handle_request()
        return statuses[0], headers, handler.wfile.getvalue()

    def test_public_health_is_minimal_and_never_authorizes_student_routes(self):
        for ready in (False, True):
            headers = self.response('', 100, '/healthz', lambda: ready, 200 if ready else 503)
            self.assertNotIn('Set-Cookie', headers)
            self.response('', 100, '/api/notebook', lambda: ready, 401)

    def test_approved_cookie_uses_remaining_server_grant_not_a_sliding_expiry(self):
        token, code = self.store.request(now=100)
        self.store.approve(code, hours=24, now=101)
        headers = self.response(token, 102)
        self.assertIn('Set-Cookie', headers)
        cookie = SimpleCookie(headers['Set-Cookie'])[backend.COOKIE]
        self.assertEqual(int(cookie['max-age']), 24 * 3600 - 1)
        self.assertTrue(cookie['secure'])
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['samesite'], 'Strict')
        later = SimpleCookie(self.response(token, 3601)['Set-Cookie'])[backend.COOKIE]
        self.assertEqual(int(later['max-age']), 24 * 3600 - 3500)
        self.assertNotIn('Set-Cookie', self.response(token, 101 + 24 * 3600))

    def test_personal_30_days_is_explicit_and_shared_stays_at_most_24_hours(self):
        token, code = self.store.request(now=100)
        with self.assertRaisesRegex(ValueError, 'APPROVAL_SCOPE'):
            self.store.approve(code, hours=25, now=101)
        with self.assertRaisesRegex(ValueError, 'APPROVAL_SCOPE'):
            self.store.approve(code, hours=30 * 24 + 1, now=101, personal=True)
        self.store.approve(code, now=101, personal=True)
        self.assertEqual(self.store.status(token, now=101 + 29 * 24 * 3600)['state'], 'approved')
        cookie = SimpleCookie(self.response(token, 102)['Set-Cookie'])[backend.COOKIE]
        self.assertEqual(int(cookie['max-age']), 30 * 24 * 3600 - 1)
        self.assertEqual(self.store.status(token, now=101 + 30 * 24 * 3600)['state'], 'expired')
        self.store.revoke(code)
        self.assertEqual(self.store.status(token, now=102)['state'], 'expired')

    def test_existing_approvals_reopen_as_shared_without_extending_their_grant(self):
        token, code = self.store.request(now=100)
        self.store.approve(code, hours=12, now=101)
        with self.store.connect() as db:
            columns = {r['name'] for r in db.execute('PRAGMA table_info(devices)')}
            if 'device_kind' in columns:
                db.execute('ALTER TABLE devices DROP COLUMN device_kind')
            before = db.execute('SELECT expires_at FROM devices WHERE code=?', (code,)).fetchone()[0]
        reopened = backend.AuthStore(Path(self.tmp.name))
        with reopened.connect() as db:
            row = dict(db.execute('SELECT * FROM devices WHERE code=?', (code,)).fetchone())
        self.assertEqual(row.get('device_kind'), 'shared')
        self.assertEqual(row['expires_at'], before)
        self.assertEqual(reopened.status(token, now=102)['state'], 'approved')

    def test_identity_survives_reopen_and_stores_no_cookie_secret(self):
        token, code = self.store.request(now=100)
        self.assertEqual(self.store.owner, backend.AuthStore(Path(self.tmp.name)).owner)
        with self.store.connect() as db:
            row = dict(db.execute('SELECT * FROM devices').fetchone())
        self.assertNotIn(token, str(row))
        self.assertEqual(row['code'], code)
        self.assertEqual(row['token_hash'], self.store.digest(token))

    def test_code_is_not_a_bearer_and_only_explicit_approval_opens_device(self):
        token, code = self.store.request(now=100)
        self.assertEqual(self.store.status(code, now=101)['state'], 'missing')
        self.assertEqual(self.store.status(token, now=101)['state'], 'pending')
        self.store.approve(code, now=101)
        self.assertEqual(self.store.status(token, now=102)['state'], 'approved')
        with self.assertRaisesRegex(ValueError, 'NOT_PENDING'):
            self.store.approve(code, now=102)
        self.store.revoke(code)
        self.assertEqual(self.store.status(token, now=103)['state'], 'expired')

    def test_expired_or_unknown_devices_cannot_be_approved(self):
        token, code = self.store.request(now=100)
        self.assertEqual(self.store.status(token, now=401)['state'], 'expired')
        with self.assertRaisesRegex(ValueError, 'NOT_PENDING'):
            self.store.approve(code, now=401)
        with self.assertRaises(ValueError):
            self.store.approve('00000000', now=101)

    def test_pending_requests_are_bounded(self):
        for _ in range(backend.MAX_PENDING):
            self.store.request(now=100)
        with self.assertRaisesRegex(ValueError, 'PAIRING_LIMIT'):
            self.store.request(now=101)

    def test_proxy_overwrites_claimed_identity_without_forwarding_secrets(self):
        headers = backend.proxy_headers({'Authorization':'SYNTHETIC-FOREIGN','Cookie':'SYNTHETIC','oai-authenticated-user-email':'forged@example.invalid','X-SPT-Backend-Token':'forged','X-Forwarded-Host':'evil.invalid','Content-Type':'application/json'}, 'SYNTHETIC-INTERNAL', 'http://127.0.0.1:4173')
        self.assertEqual(headers, {'Content-Type':'application/json','X-SPT-Backend-Token':'SYNTHETIC-INTERNAL','Origin':'http://127.0.0.1:4173'})

    def test_native_pairing_requires_operator_approval_and_keeps_cookie_path_separate(self):
        status, headers, raw = self.request('/native/pair/request', method='POST', body=b'{}', extra={'Content-Type':'application/json'})
        pair = json.loads(raw)
        self.assertEqual(status, 201)
        self.assertEqual(pair['state'], 'pending')
        self.assertNotIn('Set-Cookie', headers)
        self.assertEqual(headers['Access-Control-Allow-Origin'], backend.NATIVE_ORIGIN)
        secret = pair['deviceSecret']
        self.assertEqual(self.request('/native/pair/status', authorization='Bearer '+secret)[0], 200)
        self.assertEqual(json.loads(self.request('/native/pair/status', authorization='Bearer '+secret)[2])['state'], 'pending')
        self.assertEqual(self.request('/native/session', method='POST', authorization='Bearer '+secret)[0], 401)
        self.assertEqual(self.request('/api/identity', authorization='Bearer '+secret)[0], 401)
        self.assertEqual(self.request('/auth/status', origin='https://spt.example', cookie=backend.COOKIE+'='+secret)[0], 200)
        self.assertEqual(json.loads(self.request('/auth/status', origin='https://spt.example', cookie=backend.COOKIE+'='+secret)[2])['state'], 'missing')
        self.store.approve(pair['code'], now=101, personal=True)
        status, headers, raw = self.request('/native/session', method='POST', authorization='Bearer '+secret, now=102)
        self.assertEqual(status, 201)
        session = json.loads(raw)
        self.assertEqual(session['owner'], self.store.owner)
        self.assertEqual(session['expiresAt'], 102+backend.NATIVE_SESSION_LIFETIME)
        self.assertNotIn('Set-Cookie', headers)
        self.assertTrue(self.store.native_session_valid(session['accessToken'], now=102))
        with self.store.connect() as db:
            stored = dict(db.execute('SELECT * FROM native_sessions').fetchone())
        self.assertNotIn(session['accessToken'], str(stored))
        self.assertFalse(self.store.native_session_valid(session['accessToken'], now=session['expiresAt']))
        self.assertEqual(self.request('/api/identity', authorization='Bearer '+session['accessToken'], now=session['expiresAt'])[0], 401)
        self.store.revoke(pair['code'])
        self.assertFalse(self.store.native_session_valid(session['accessToken'], now=103))
        self.assertEqual(self.request('/native/session', method='POST', authorization='Bearer '+secret, now=103)[0], 401)

    def test_native_origin_preflight_csrf_and_bearer_proxy(self):
        secret, code = self.store.request(now=100, client_kind='native')
        self.store.approve(code, now=101, personal=True)
        session, _ = self.store.issue_native_session(secret, now=102)
        for foreign in ('https://foreign.example', 'capacitor://evil', 'https://spt.example.evil'):
            self.assertEqual(self.request('/api/identity', origin=foreign, authorization='Bearer '+session, now=103)[0], 403)
            self.assertEqual(self.request('/native/session', method='POST', origin=foreign, authorization='Bearer '+secret, now=103)[0], 403)
        self.assertEqual(self.request('/api/identity', origin=backend.NATIVE_ORIGIN, cookie=backend.COOKIE+'='+secret, now=103)[0], 400)
        self.assertEqual(self.request('/api/identity', origin='https://spt.example', authorization='Bearer '+session, now=103)[0], 401)
        self.assertEqual(self.request('/api/classroom', method='POST', origin=None, authorization='Bearer '+session, body=b'{}', now=103)[0], 403)
        status, headers, _ = self.request('/api/classroom', method='OPTIONS', extra={'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type'}, now=103)
        self.assertEqual(status, 204)
        self.assertEqual(headers['Access-Control-Allow-Origin'], backend.NATIVE_ORIGIN)
        self.assertNotIn('Access-Control-Allow-Credentials', headers)
        self.assertEqual(self.request('/api/classroom', method='OPTIONS', extra={'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-spt-backend-token'}, now=103)[0], 403)
        self.assertEqual(self.request('/api/classroom', method='OPTIONS', origin='https://foreign.example', extra={'Access-Control-Request-Method':'POST'}, now=103)[0], 403)

        class Upstream:
            status = 200
            def __init__(self, owner): self.payload = json.dumps({'ownerKey':owner}).encode()
            def getheaders(self): return [('Content-Type', 'application/json')]
            def read(self, _size):
                payload, self.payload = self.payload, b''
                return payload
        class Connection:
            def __init__(self, owner): self.calls, self.owner = [], owner
            def request(self, method, path, body=None, headers=None): self.calls.append((method, path, body, headers))
            def getresponse(self): return Upstream(self.owner)
            def close(self): pass
        connection = Connection(self.store.owner)
        with patch.object(backend.http.client, 'HTTPConnection', return_value=connection):
            status, headers, raw = self.request('/api/identity', authorization='Bearer '+session, extra={'oai-authenticated-user-email':'forged@example.invalid','X-SPT-Backend-Token':'forged','X-Forwarded-Host':'foreign.example'}, now=103)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), {'ownerKey': self.store.owner})
        self.assertEqual(headers['Access-Control-Allow-Origin'], backend.NATIVE_ORIGIN)
        self.assertEqual(connection.calls[0][3], {'X-SPT-Backend-Token':'SYNTHETIC-INTERNAL','Origin':'http://127.0.0.1:4173'})
        self.assertEqual(self.request('/native/session/revoke', method='POST', authorization='Bearer '+session, now=103)[0], 200)
        self.assertEqual(self.request('/api/identity', authorization='Bearer '+session, now=104)[0], 401)

        browser, browser_code = self.store.request(now=104)
        self.store.approve(browser_code, now=105)
        self.assertEqual(self.request('/api/classroom', method='POST', origin=None, cookie=backend.COOKIE+'='+browser, body=b'{}', now=106)[0], 403)
        self.assertEqual(self.request('/auth/status', origin='https://spt.example', cookie=backend.COOKIE+'='+browser, now=106)[0], 200)
        status, headers, raw = self.request('/auth/request', method='POST', origin='https://spt.example', body=b'{}', now=107)
        self.assertEqual(status, 201)
        self.assertEqual(json.loads(raw)['state'], 'pending')
        self.assertTrue(SimpleCookie(headers['Set-Cookie'])[backend.COOKIE]['httponly'])
        self.assertNotIn('Access-Control-Allow-Origin', headers)

    def test_only_exact_https_or_loopback_origins(self):
        self.assertEqual(backend.public_origin('https://spt.example/'),'https://spt.example')
        self.assertEqual(backend.public_origin('http://127.0.0.1:4177'),'http://127.0.0.1:4177')
        for bad in ['http://public.example','https://user:pass@spt.example','https://spt.example/path','https://spt.example?x=1','file:///tmp/app','https://localhost']:
            with self.subTest(origin=bad), self.assertRaises(ValueError):
                backend.public_origin(bad)

    def test_stopped_native_consumer_cannot_dispatch_a_late_request(self):
        spec = importlib.util.spec_from_file_location('spt_native_runner_test', ROOT / 'scripts/spt_native_runner.py')
        native = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(native)
        runner = native.NativeAnalysis(Path(self.tmp.name), 1)
        runner.stop()
        payload = {'requestId':'11111111-1111-4111-8111-111111111111','studentId':'SYNTHETIC','date':'2026-10-16','sessions':[{'sessionId':'22222222-2222-4222-8222-222222222222','entries':[]}]}
        with patch.object(native.subprocess, 'Popen', side_effect=AssertionError('NATIVE_DISPATCH_AFTER_STOP')) as dispatch:
            with self.assertRaisesRegex(ValueError, 'STOPPED'):
                runner.run(payload)
            dispatch.assert_not_called()


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""SPT's paired-device gateway. No public bind, native service or Site changes.

This gateway fronts only the existing, separately launched loopback SPT Worker.
Device approval is a local operator action; a public pairing code alone is not a
credential. Browser cookies contain random secrets; the app store keeps hashes.
The native OAuth/provider credentials never pass through this gateway.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import tempfile
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote, urlencode
import uuid

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATE = ROOT / '.sites-runtime/backend-private'
COOKIE = 'spt_device'
MAX_BODY = 8 * 1024 * 1024
MAX_PENDING = 6
TRANSFER_MAX_BYTES = 67108864
TRANSFER_PART_BYTES = 1048576
TRANSFER_LIFETIME = 21600
TRANSFER_PROTOCOL = 'spt.audio-transfer.v1'
NATIVE_ORIGIN = 'capacitor://localhost'
NATIVE_SESSION_LIFETIME = 15 * 60
IMPORT_ID = re.compile(r'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$')


class TransferRejected(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class AuthStore:
    def __init__(self, root: Path, owner: str | None = None):
        if owner is not None and not re.fullmatch(r'native-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', owner):
            raise ValueError('ACCOUNT_OWNER_INVALID')
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = root / 'device-auth.sqlite'
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS devices (
                    token_hash TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL,
                    created_at REAL NOT NULL, expires_at REAL NOT NULL,
                    approved INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0,
                    device_kind TEXT NOT NULL DEFAULT 'shared'
                );
                CREATE TABLE IF NOT EXISTS audio_transfer_grants (
                    id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL,
                    device_hash TEXT NOT NULL, import_id TEXT NOT NULL,
                    created_at REAL NOT NULL, expires_at REAL NOT NULL,
                    revoked INTEGER NOT NULL DEFAULT 0, filename TEXT,
                    size INTEGER, sha256 TEXT, input_confirmed INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS audio_transfer_import ON audio_transfer_grants(import_id);
                CREATE TABLE IF NOT EXISTS native_sessions (
                    token_hash TEXT PRIMARY KEY, device_hash TEXT NOT NULL,
                    created_at REAL NOT NULL, expires_at REAL NOT NULL,
                    revoked INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS native_sessions_device ON native_sessions(device_hash);
            ''')
            db.execute('BEGIN IMMEDIATE')
            columns = {row['name'] for row in db.execute('PRAGMA table_info(devices)')}
            if 'device_kind' not in columns:
                db.execute("ALTER TABLE devices ADD COLUMN device_kind TEXT NOT NULL DEFAULT 'shared'")
            if 'client_kind' not in columns:
                db.execute("ALTER TABLE devices ADD COLUMN client_kind TEXT NOT NULL DEFAULT 'browser'")
            transfer_columns = {row['name'] for row in db.execute('PRAGMA table_info(audio_transfer_grants)')}
            if 'client_kind' not in transfer_columns:
                db.execute("ALTER TABLE audio_transfer_grants ADD COLUMN client_kind TEXT NOT NULL DEFAULT 'browser'")
            existing = db.execute('SELECT owner FROM account WHERE id=1').fetchone()
            if existing and owner is not None and existing['owner'] != owner:
                raise ValueError('ACCOUNT_OWNER_MISMATCH')
            db.execute('INSERT OR IGNORE INTO account VALUES(1,?)', (owner or 'native-' + str(uuid.uuid4()),))
        os.chmod(self.path, 0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @property
    def owner(self):
        with self.connect() as db:
            return db.execute('SELECT owner FROM account WHERE id=1').fetchone()['owner']

    @staticmethod
    def digest(token: str):
        return hashlib.sha256(token.encode()).hexdigest()

    def request(self, now: float | None = None, *, client_kind='browser'):
        if client_kind not in ('browser', 'native'):
            raise ValueError('CLIENT_KIND_INVALID')
        now = time.time() if now is None else now
        token = secrets.token_urlsafe(32)
        code = secrets.token_hex(4).upper()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            count = db.execute('SELECT count(*) FROM devices WHERE approved=0 AND revoked=0 AND expires_at>?', (now,)).fetchone()[0]
            recent = db.execute('SELECT count(*) FROM devices WHERE created_at>?', (now - 3600,)).fetchone()[0]
            if count >= MAX_PENDING or recent >= 30:
                raise ValueError('PAIRING_LIMIT')
            db.execute('INSERT INTO devices(token_hash,code,created_at,expires_at,client_kind) VALUES(?,?,?,?,?)', (self.digest(token), code, now, now + 300, client_kind))
        return token, code

    def status(self, token: str, now: float | None = None):
        now = time.time() if now is None else now
        if not re.fullmatch(r'[A-Za-z0-9_-]{40,100}', token):
            return {'state': 'missing'}
        with self.connect() as db:
            row = db.execute('SELECT code,expires_at,approved,revoked,device_kind FROM devices WHERE token_hash=? AND client_kind=?', (self.digest(token), 'browser')).fetchone()
        if not row:
            return {'state': 'missing'}
        if row['revoked'] or row['expires_at'] <= now:
            return {'state': 'expired'}
        return {'state': 'approved' if row['approved'] else 'pending', 'code': row['code'], 'expiresAt': row['expires_at'], 'deviceKind': row['device_kind']}

    def native_status(self, secret: str, now: float | None = None):
        now = time.time() if now is None else now
        if not isinstance(secret, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', secret):
            return {'state': 'missing'}
        with self.connect() as db:
            row = db.execute('SELECT code,expires_at,approved,revoked,device_kind FROM devices WHERE token_hash=? AND client_kind=?', (self.digest(secret), 'native')).fetchone()
        if row is None:
            return {'state': 'missing'}
        if row['revoked'] or row['expires_at'] <= now:
            return {'state': 'expired'}
        return {'state': 'approved' if row['approved'] else 'pending', 'code': row['code'], 'expiresAt': row['expires_at'], 'deviceKind': row['device_kind']}

    def issue_native_session(self, secret: str, now: float | None = None):
        now = time.time() if now is None else now
        if self.native_status(secret, now)['state'] != 'approved':
            raise ValueError('DEVICE_APPROVAL_REQUIRED')
        session = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            device = db.execute('SELECT expires_at FROM devices WHERE token_hash=? AND client_kind=? AND approved=1 AND revoked=0 AND expires_at>?', (self.digest(secret), 'native', now)).fetchone()
            if device is None:
                raise ValueError('DEVICE_APPROVAL_REQUIRED')
            db.execute('DELETE FROM native_sessions WHERE expires_at<=? OR revoked=1', (now,))
            active = db.execute('SELECT count(*) FROM native_sessions WHERE device_hash=?', (self.digest(secret),)).fetchone()[0]
            if active >= 32:
                raise ValueError('SESSION_LIMIT')
            expires = min(device['expires_at'], now + NATIVE_SESSION_LIFETIME)
            db.execute('INSERT INTO native_sessions(token_hash,device_hash,created_at,expires_at) VALUES(?,?,?,?)', (self.digest(session), self.digest(secret), now, expires))
        return session, expires

    def native_session_valid(self, session: str, now: float | None = None):
        now = time.time() if now is None else now
        if not isinstance(session, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', session):
            return False
        with self.connect() as db:
            row = db.execute('''SELECT 1 FROM native_sessions s JOIN devices d ON d.token_hash=s.device_hash
                WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND d.client_kind='native'
                AND d.approved=1 AND d.revoked=0 AND d.expires_at>?''', (self.digest(session), now, now)).fetchone()
        return row is not None

    def revoke_native_session(self, session: str):
        if not self.native_session_valid(session):
            raise ValueError('SESSION_INVALID')
        with self.connect() as db:
            db.execute('UPDATE native_sessions SET revoked=1 WHERE token_hash=?', (self.digest(session),))

    def approve(self, code: str, hours: float | None = None, now: float | None = None, *, personal: bool = False):
        now = time.time() if now is None else now
        limit = 30 * 24 if personal else 24
        hours = (limit if personal else 12) if hours is None else hours
        if not re.fullmatch(r'[A-F0-9]{8}', code) or not 0 < hours <= limit:
            raise ValueError('APPROVAL_SCOPE')
        with self.connect() as db:
            result = db.execute('UPDATE devices SET approved=1,expires_at=?,device_kind=? WHERE code=? AND approved=0 AND revoked=0 AND expires_at>?', (now + hours * 3600, 'personal' if personal else 'shared', code, now))
            if result.rowcount != 1:
                raise ValueError('PAIRING_NOT_PENDING')

    def revoke(self, code: str):
        with self.connect() as db:
            result = db.execute('UPDATE devices SET revoked=1 WHERE code=? AND revoked=0', (code,))
            if result.rowcount != 1:
                raise ValueError('DEVICE_NOT_FOUND')

    def pending(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute('SELECT code,created_at,expires_at FROM devices WHERE approved=0 AND revoked=0 AND expires_at>? ORDER BY created_at', (time.time(),))]

    def _transfer_row(self, db, token, now):
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            raise TransferRejected(403, '전송 권한이 없거나 만료되었습니다. SPT에서 같은 녹음의 전송 연결을 다시 준비하세요.')
        row = db.execute('''SELECT g.* FROM audio_transfer_grants g JOIN devices d ON d.token_hash=g.device_hash
            WHERE g.token_hash=? AND g.revoked=0 AND g.expires_at>? AND d.approved=1 AND d.revoked=0 AND d.expires_at>?''', (self.digest(token), now, now)).fetchone()
        if row is None:
            raise TransferRejected(403, '전송 권한이 없거나 만료되었습니다. 원본 파일은 지우지 마세요.')
        return dict(row)

    def transfer(self, token):
        with self.connect() as db:
            return self._transfer_row(db, token, time.time())

    def native_session_device(self, session, now: float | None = None):
        now = time.time() if now is None else now
        if not isinstance(session, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', session):
            return None
        with self.connect() as db:
            row = db.execute('''SELECT d.token_hash FROM native_sessions s JOIN devices d ON d.token_hash=s.device_hash
                WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND d.client_kind='native'
                AND d.approved=1 AND d.revoked=0 AND d.expires_at>?''', (self.digest(session), now, now)).fetchone()
        return row['token_hash'] if row else None

    def issue_transfer(self, parent, import_id, *, native=False):
        if not isinstance(import_id, str) or not IMPORT_ID.fullmatch(import_id):
            raise TransferRejected(400, '녹음 연결 ID를 확인하세요.')
        now = time.time()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if native:
                device = db.execute('''SELECT d.* FROM native_sessions s JOIN devices d ON d.token_hash=s.device_hash
                    WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND d.client_kind='native'
                    AND d.approved=1 AND d.revoked=0 AND d.expires_at>?''', (self.digest(parent), now, now)).fetchone()
            else:
                device = db.execute('SELECT * FROM devices WHERE token_hash=? AND client_kind=? AND approved=1 AND revoked=0 AND expires_at>?', (self.digest(parent), 'browser', now)).fetchone()
            if device is None:
                raise TransferRejected(403, '승인된 기기에서 전송을 준비하세요.')
            if db.execute('SELECT COUNT(*) FROM audio_transfer_grants WHERE created_at>?', (now-3600,)).fetchone()[0] >= 60:
                raise TransferRejected(429, '전송 연결을 너무 자주 만들었습니다. 보관 파일은 유지하세요.')
            # A renewed authority retains the first source-content claim; it does
            # not authorize replacing a partial or already completed original.
            prior = db.execute('SELECT filename,size,sha256,input_confirmed FROM audio_transfer_grants WHERE import_id=? AND sha256 IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1', (import_id,)).fetchone()
            db.execute('UPDATE audio_transfer_grants SET revoked=1 WHERE import_id=?', (import_id,))
            token, gid, expires = secrets.token_urlsafe(32), str(uuid.uuid4()), min(device['expires_at'], now+TRANSFER_LIFETIME)
            values = tuple(prior) if prior is not None else (None,None,None,0)
            db.execute('INSERT INTO audio_transfer_grants(id,token_hash,device_hash,import_id,created_at,expires_at,filename,size,sha256,input_confirmed,client_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?)', (gid,self.digest(token),device['token_hash'],import_id,now,expires,*values,'native' if native else 'browser'))
        return token, expires

    def bind_transfer(self, token, filename, size, digest):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = self._transfer_row(db, token, time.time())
            prior = db.execute('SELECT filename,size,sha256 FROM audio_transfer_grants WHERE import_id=? AND sha256 IS NOT NULL LIMIT 1', (row['import_id'],)).fetchone()
            if prior is not None and tuple(prior) != (filename,size,digest):
                raise TransferRejected(409, '이 녹음에 연결된 원본과 다른 파일입니다. 기존 원본은 바꾸지 않습니다.')
            db.execute('UPDATE audio_transfer_grants SET filename=?,size=?,sha256=? WHERE id=?', (filename,size,digest,row['id']))

    def confirm_transfer_input(self, token):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = self._transfer_row(db, token, time.time())
            db.execute('UPDATE audio_transfer_grants SET input_confirmed=1 WHERE id=? AND sha256 IS NOT NULL', (row['id'],))

    def revoke_transfer(self, parent, import_id, *, native=False):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            now = time.time()
            if native:
                approved = db.execute('''SELECT 1 FROM native_sessions s JOIN devices d ON d.token_hash=s.device_hash
                    WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND d.client_kind='native'
                    AND d.approved=1 AND d.revoked=0 AND d.expires_at>?''', (self.digest(parent), now, now)).fetchone()
            else:
                approved = db.execute('SELECT 1 FROM devices WHERE token_hash=? AND client_kind=? AND approved=1 AND revoked=0 AND expires_at>?', (self.digest(parent), 'browser', now)).fetchone()
            if approved is None:
                raise TransferRejected(403, '승인된 기기에서 전송 권한을 철회하세요.')
            db.execute('UPDATE audio_transfer_grants SET revoked=1 WHERE import_id=?', (import_id,))


def import_request(port, token, method, path, payload=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=240)
    binary = isinstance(payload, bytes)
    try:
        headers = {'X-SPT-Backend-Token':token,'Origin':f'http://127.0.0.1:{port}','Content-Type':'application/octet-stream' if binary else 'application/json'}
        body = payload if binary else json.dumps(payload).encode() if payload is not None else None
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse();raw = response.read(262145)
        if response.status != 200 or len(raw)>262144:
            raise TransferRejected(response.status if response.status in (400,403,404,409,413,429) else 502, '원본 보관 응답을 확인하지 못했습니다. 같은 파일을 유지하고 SPT에서 상태를 확인하세요.')
        value = json.loads(raw)
        if not isinstance(value, dict):raise ValueError('INVALID_IMPORT_RESULT')
        return value
    except (OSError,http.client.HTTPException,ValueError):
        raise TransferRejected(502, '전송 결과 미확인입니다. 새 녹음을 하지 말고 보관된 같은 파일로 이어 전송하세요.') from None
    finally:connection.close()


def transfer_receipt(row, grant, origin):
    if row.get('id') != grant['import_id'] or not isinstance(row.get('session_id'),str) or not isinstance(row.get('student_id'),str) or not isinstance(row.get('class_date'),str):
        raise TransferRejected(502, '녹음의 원래 학생과 수업일을 확인하지 못했습니다.')
    parts = row.get('parts') or []
    received = sum(p['size'] for p in parts)
    complete = bool(row.get('size')) and received==row['size'] and [p['seq'] for p in parts]==list(range(len(parts)))
    stored = complete and row.get('status') in ('stored','transcribed')
    return {'protocol':TRANSFER_PROTOCOL,'importId':row['id'],'sessionId':row['session_id'],'studentId':row['student_id'],'classDate':row['class_date'],'purpose':row.get('session_purpose'),'status':row['status'],'stored':stored,'receivedBytes':received,'totalBytes':row.get('size'),'duration':row.get('duration'),'inputConfirmed':bool(grant['input_confirmed']),'sha256':grant['sha256'] if grant['input_confirmed'] else None,'returnURL':origin+'/?'+urlencode({'student':row['student_id'],'date':row['class_date'],'view':'record','audioImport':row['id']}),'message':'원본 보관 완료 · 전사 요청 없음' if stored else '원본 보관 결과를 SPT에서 확인하세요. 로컬 파일은 유지하세요.'}


def public_origin(value: str):
    url = urlsplit(value)
    if url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise ValueError('EXACT_ORIGIN_REQUIRED')
    if url.scheme == 'http' and url.hostname == '127.0.0.1' and url.port:
        return value.rstrip('/')
    if url.scheme != 'https' or not url.hostname or url.hostname in ('localhost', '127.0.0.1', '0.0.0.0'):
        raise ValueError('HTTPS_OR_LOOPBACK_REQUIRED')
    return value.rstrip('/')


def proxy_headers(headers, token: str, worker_origin: str):
    # Never forward cookies, Authorization, Site identity, proxy headers or the
    # caller's claimed backend proof. Only the paired gateway supplies the proof.
    allowed = {'accept', 'accept-language', 'content-type', 'range', 'rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-url'}
    out = {k: v for k, v in headers.items() if k.lower() in allowed}
    out['X-SPT-Backend-Token'] = token
    out['Origin'] = worker_origin
    return out


AUTH_HTML = '''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SPT 기기 승인</title><style>body{font:18px system-ui;max-width:32rem;margin:8vh auto;padding:24px;line-height:1.7;background:#f6faf9;color:#18302b}button{font:inherit;padding:12px 20px}code{font-size:2rem;letter-spacing:.15em}p{overflow-wrap:anywhere}</style><h1>SPT 기기 승인</h1><p>승인된 교사의 기기에서만 기록장을 엽니다. 이 화면은 학생 기록을 불러오지 않습니다.</p><button id="request">이 기기 사용 요청</button><p id="state" role="status"></p><code id="code"></code><p>표시된 기기 코드를 Hermes 대화에서 확인해 주세요. 코드 확인만으로 로그인되지는 않으며, 같은 브라우저에서 기다려야 합니다.</p><script src="/auth.js"></script></html>'''
AUTH_JS = '''const state=document.getElementById('state'),code=document.getElementById('code'),button=document.getElementById('request');let timer;async function check(){try{const r=await fetch('/auth/status',{cache:'no-store'}),v=await r.json();if(v.state==='approved'){location.replace('/');return;}code.textContent=v.code||'';state.textContent=v.state==='pending'?'기기 승인 대기 중':v.state==='expired'?'기기 요청이 만료되었거나 철회되었습니다. 다시 요청하세요.':'먼저 이 기기의 사용을 요청하세요.';button.disabled=v.state==='pending';if(v.state==='pending'){clearTimeout(timer);timer=setTimeout(check,3000);}}catch{state.textContent='연결이 끊겼습니다. 기록장이 열린 것으로 처리하지 않습니다.';button.disabled=false;}}button.onclick=async()=>{button.disabled=true;try{const r=await fetch('/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error();await check();}catch{state.textContent='요청을 만들지 못했습니다. 잠시 후 다시 시도하세요.';button.disabled=false;}};check();'''


def handler_for(store: AuthStore, origin: str, worker_port: int, internal_token: str, readiness=None):
    origin = public_origin(origin)
    worker_origin = f'http://127.0.0.1:{worker_port}'
    host = urlsplit(origin).netloc
    secure = origin.startswith('https:')
    transfer_slots = threading.BoundedSemaphore(2)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # no cookies, URL queries, student bodies or credentials in logs

        def reply(self, status, value, content_type='application/json', cookie=None):
            raw = value.encode() if isinstance(value, str) else json.dumps(value).encode()
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(raw)))
            self.security_headers()
            if cookie:
                self.send_header('Set-Cookie', cookie)
            self.end_headers()
            self.wfile.write(raw)

        def security_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Permissions-Policy', 'microphone=(self), camera=()')
            self.send_header('X-Frame-Options', 'DENY')
            if getattr(self, 'native_cors', False):
                self.send_header('Access-Control-Allow-Origin', NATIVE_ORIGIN)
                self.send_header('Vary', 'Origin')

        def bearer(self):
            values = self.headers.get_all('Authorization', [])
            if len(values) != 1 or not values[0].startswith('Bearer '):
                return ''
            return values[0][7:]

        def native_request(self, path, length):
            if self.headers.get('Cookie') or self.path != path:
                return self.reply(400, {'error': 'NATIVE_REQUEST_REJECTED'})
            if path == '/native/pair/request' and self.command == 'POST':
                if length != 2 or self.headers.get('Content-Type') != 'application/json' or self.rfile.read(length) != b'{}' or self.headers.get('Authorization'):
                    return self.reply(400, {'error': 'NATIVE_REQUEST_REJECTED'})
                try:
                    secret, code = store.request(client_kind='native')
                except ValueError:
                    return self.reply(429, {'error': 'PAIRING_LIMIT'})
                return self.reply(201, {'state': 'pending', 'code': code, 'deviceSecret': secret, 'expiresAt': store.native_status(secret)['expiresAt']})
            secret = self.bearer()
            if path == '/native/pair/status' and self.command == 'GET' and length == 0:
                return self.reply(200, store.native_status(secret))
            if path == '/native/session' and self.command == 'POST' and length == 0:
                try:
                    session, expires = store.issue_native_session(secret)
                except ValueError as error:
                    if str(error) == 'SESSION_LIMIT':
                        return self.reply(429, {'error': 'SESSION_LIMIT'})
                    return self.reply(401, {'error': 'DEVICE_APPROVAL_REQUIRED'})
                return self.reply(201, {'accessToken': session, 'expiresAt': expires, 'owner': store.owner, 'tokenType': 'Bearer'})
            if path == '/native/session/revoke' and self.command == 'POST' and length == 0:
                try:
                    store.revoke_native_session(secret)
                except ValueError:
                    return self.reply(401, {'error': 'SESSION_INVALID'})
                return self.reply(200, {'revoked': True})
            return self.reply(405, {'error': 'METHOD_REJECTED'})

        def token(self):
            try:
                cookies = SimpleCookie(self.headers.get('Cookie', ''))
                return cookies[COOKIE].value if COOKIE in cookies else ''
            except Exception:
                return ''

        def transfer_request(self, path, length):
            try:
                if self.path != path:
                    raise TransferRejected(400, '전송 주소에 추가 정보를 붙일 수 없습니다.')
                native = self.native_cors
                def authorized_transfer(token):
                    grant = store.transfer(token)
                    if grant['client_kind'] != ('native' if native else 'browser'):
                        raise TransferRejected(403, 'TRANSFER_CLIENT_REJECTED')
                    if native and store.native_session_device(self.bearer()) != grant['device_hash']:
                        raise TransferRejected(401, 'DEVICE_APPROVAL_REQUIRED')
                    return grant
                if path in ('/api/audio-transfer/grant','/api/audio-transfer/revoke'):
                    if self.command!='POST' or self.headers.get('Origin')!=(NATIVE_ORIGIN if native else origin):
                        raise TransferRejected(403, '승인된 SPT 화면에서 전송을 준비하세요.')
                    parent=self.bearer() if native else self.token()
                    if (store.native_session_device(parent) is None if native else store.status(parent)['state']!='approved'):
                        raise TransferRejected(401, 'DEVICE_APPROVAL_REQUIRED')
                    if not 0<length<=2048:raise TransferRejected(413, '전송 준비 요청 크기를 확인하세요.')
                    data=json.loads(self.rfile.read(length))
                    if not isinstance(data,dict) or set(data)!={'id'} or not isinstance(data['id'],str) or not IMPORT_ID.fullmatch(data['id']):raise TransferRejected(400, '녹음 연결 ID를 확인하세요.')
                    row=import_request(worker_port,internal_token,'GET','/api/audio-import?id='+data['id'])
                    if row.get('id')!=data['id']:raise TransferRejected(409, '녹음 대상이 다릅니다.')
                    if path.endswith('/revoke'):
                        store.revoke_transfer(parent,data['id'],native=native);return self.reply(200,{'revoked':True,'importId':data['id']})
                    # Validate the actual returned source before minting rights.
                    transfer_receipt(row,{'import_id':data['id'],'input_confirmed':0,'sha256':None},origin)
                    token,expires=store.issue_transfer(parent,data['id'],native=native);grant=authorized_transfer(token);receipt=transfer_receipt(row,grant,origin)
                    return self.reply(201,{**receipt,'token':token,'expiresAt':expires,'uploadURL':origin+'/api/audio-transfer/upload','statusURL':origin+'/api/audio-transfer/status'})
                if path not in ('/api/audio-transfer/upload','/api/audio-transfer/status'):
                    raise TransferRejected(404, '전송 경로가 없습니다.')
                if self.headers.get('Origin') not in ((NATIVE_ORIGIN,) if native else (None,origin)):raise TransferRejected(403, 'ORIGIN_REJECTED')
                if len(self.headers.get_all('X-SPT-Transfer',[]))!=1:raise TransferRejected(403, '전송 권한을 확인하세요.')
                token=self.headers.get('X-SPT-Transfer');grant=authorized_transfer(token);import_id=grant['import_id']
                def current():return import_request(worker_port,internal_token,'GET','/api/audio-import?id='+import_id)
                if path.endswith('/status'):
                    if self.command!='GET' or length:raise TransferRejected(405, '상태 확인은 파일을 보내지 않습니다.')
                    row=current();return self.reply(200,transfer_receipt(row,authorized_transfer(token),origin))
                if self.command!='POST':raise TransferRejected(405, '파일 전송 방식을 확인하세요.')
                if not 0<length<=TRANSFER_MAX_BYTES:raise TransferRejected(413, '원본 최대 크기는 64 MiB입니다.')
                encoded=self.headers.get('X-SPT-Filename','')
                if len(self.headers.get_all('X-SPT-Filename',[]))!=1 or not encoded.isascii() or re.search(r'%(?![0-9a-fA-F]{2})',encoded):raise TransferRejected(400, '원본 이름의 URL 인코딩을 확인하세요.')
                filename=unquote(encoded,encoding='utf-8',errors='strict')
                if not 1<=len(filename)<=255 or any(c in filename for c in ('/','\\','\r','\n','\0')):raise TransferRejected(400, '원본 이름을 확인하세요.')
                if filename.rsplit('.',1)[-1].lower() not in ('m4a','mp4','wav','mp3','aac','caf','flac','ogg','webm'):raise TransferRejected(400, '지원하는 녹음 파일인지 확인하세요.')
                if not transfer_slots.acquire(blocking=False):raise TransferRejected(429, '다른 원본 전송 중입니다. 보관 파일로 잠시 후 다시 시도하세요.')
                try:
                    row=current();remaining=length;digest=hashlib.sha256();deadline=time.monotonic()+180
                    with tempfile.SpooledTemporaryFile(max_size=2*TRANSFER_PART_BYTES,dir=store.path.parent) as source:
                        while remaining:
                            left=deadline-time.monotonic()
                            if left<=0:raise TransferRejected(408, '이번 파일 전송 시간이 끝났습니다. 로컬 원본은 유지하고 같은 녹음으로 다시 전송하세요.')
                            if getattr(self,'connection',None) is not None:self.connection.settimeout(left)
                            chunk=self.rfile.read1(min(65536,remaining))
                            if not chunk:raise TransferRejected(400, '원본 전송이 중단됐습니다. 보관한 같은 파일로 이어 전송하세요.')
                            source.write(chunk);digest.update(chunk);remaining-=len(chunk)
                        # Do not let a refused replacement poison a future
                        # grant's first-content claim for an existing original.
                        if row.get('filename') is not None and (row['filename']!=filename or row['size']!=length):raise TransferRejected(409, '기존 원본 이름 또는 크기가 다릅니다.')
                        expected=[];source.seek(0)
                        while part:=source.read(TRANSFER_PART_BYTES):expected.append({'seq':len(expected),'size':len(part),'hash':hashlib.sha256(part).hexdigest()})
                        for old in row.get('parts') or []:
                            if old['seq']<0 or old['seq']>=len(expected) or any(old[k]!=expected[old['seq']][k] for k in ('seq','size','hash')):raise TransferRejected(409, '보관한 구간과 다른 파일입니다. 덮어쓰지 않습니다.')
                        store.bind_transfer(token,filename,length,digest.hexdigest())
                        if row.get('filename') is None:
                            import_request(worker_port,internal_token,'POST','/api/audio-import',{'action':'file','id':import_id,'filename':filename,'mime':'application/octet-stream','size':length});row=current()
                        elif row['filename']!=filename or row['size']!=length:raise TransferRejected(409, '기존 원본 이름 또는 크기가 다릅니다.')
                        source.seek(0);parts={p['seq']:p for p in row.get('parts') or []};seq=0
                        while chunk:=source.read(TRANSFER_PART_BYTES):
                            authorized_transfer(token);old=parts.get(seq);part_hash=hashlib.sha256(chunk).hexdigest()
                            if old:
                                if old['size']!=len(chunk) or old['hash']!=part_hash:raise TransferRejected(409, '보관한 구간과 다른 파일입니다. 덮어쓰지 않습니다.')
                            else:import_request(worker_port,internal_token,'POST',f'/api/audio-import?id={import_id}&part={seq}',chunk)
                            seq+=1
                        row=current()
                        if [{k:p[k] for k in ('seq','size','hash')} for p in row.get('parts') or []]!=expected:raise TransferRejected(409, '서버의 보관 구간을 확인하지 못했습니다. 같은 원본을 유지하세요.')
                        store.confirm_transfer_input(token);authorized_transfer(token)
                        if row['status']=='uploading':import_request(worker_port,internal_token,'POST','/api/audio-import',{'action':'finalize','id':import_id});row=current()
                        # A delegated upload cannot recover an older, possibly
                        # transcription-bearing attempt. Leave that to the
                        # authenticated owner's explicit SPT recovery control.
                        return self.reply(200,transfer_receipt(row,authorized_transfer(token),origin))
                finally:transfer_slots.release()
            except TransferRejected as error:
                self.close_connection=True;return self.reply(error.status,{'error':str(error),'stored':False})
            except (OSError,UnicodeError,ValueError,TypeError,KeyError):
                self.close_connection=True;return self.reply(502,{'error':'전송 결과 미확인입니다. 보관 파일을 유지하고 같은 녹음의 상태를 확인하세요.','stored':False})

        def handle_request(self):
            if len(self.headers.get_all('Host', [])) != 1 or self.headers.get('Host') != host:
                return self.reply(400, {'error': 'HOST_REJECTED'})
            request_origin = self.headers.get('Origin')
            if len(self.headers.get_all('Origin', [])) > 1 or request_origin not in (None, origin, NATIVE_ORIGIN):
                return self.reply(403, {'error': 'ORIGIN_REJECTED'})
            self.native_cors = request_origin == NATIVE_ORIGIN
            if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) > 1:
                return self.reply(400, {'error': 'FRAMING_REJECTED'})
            path = urlsplit(self.path).path
            if self.command == 'OPTIONS':
                requested_method = self.headers.get('Access-Control-Request-Method')
                requested_headers = self.headers.get('Access-Control-Request-Headers', '')
                header_names = [name.strip().lower() for name in requested_headers.split(',') if name.strip()]
                allowed_path = path.startswith('/api/') or path in ('/native/pair/request', '/native/pair/status', '/native/session', '/native/session/revoke')
                allowed_method = requested_method in ('GET', 'POST')
                allowed_headers = set(header_names) <= ({'authorization', 'content-type', 'accept', 'x-spt-transfer', 'x-spt-filename'} if path.startswith('/api/audio-transfer/') else {'authorization', 'content-type', 'accept'})
                if not self.native_cors or not allowed_path or not allowed_method or not allowed_headers or self.path != path:
                    return self.reply(403, {'error': 'PREFLIGHT_REJECTED'})
                self.send_response(204)
                self.send_header('Access-Control-Allow-Methods', 'GET, POST')
                self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-SPT-Transfer, X-SPT-Filename' if path.startswith('/api/audio-transfer/') else 'Authorization, Content-Type, Accept')
                self.send_header('Access-Control-Max-Age', '300')
                self.security_headers()
                self.end_headers()
                return
            if self.command not in ('GET', 'POST'):
                return self.reply(405, {'error': 'METHOD_REJECTED'})
            if path.startswith('/native/') and not self.native_cors:
                return self.reply(403, {'error': 'ORIGIN_REJECTED'})
            if self.native_cors and not (path.startswith('/api/') or path.startswith('/native/')):
                return self.reply(403, {'error': 'NATIVE_PATH_REJECTED'})
            if self.native_cors and self.headers.get('Cookie'):
                return self.reply(400, {'error': 'NATIVE_COOKIE_REJECTED'})
            if path.startswith('/api/audio-transfer/'):
                try:
                    raw_length=self.headers.get('Content-Length','0')
                    if not re.fullmatch(r'0|[1-9][0-9]{0,8}',raw_length):raise ValueError()
                    length=int(raw_length)
                except ValueError:return self.reply(413,{'error':'INPUT_LIMIT'})
                return self.transfer_request(path,length)
            if self.command == 'POST' and request_origin not in (origin, NATIVE_ORIGIN):
                return self.reply(403, {'error': 'ORIGIN_REJECTED'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 <= length <= MAX_BODY:
                    raise ValueError()
            except ValueError:
                return self.reply(413, {'error': 'INPUT_LIMIT'})
            path = urlsplit(self.path).path
            if not self.path.startswith('/') or self.path.startswith('//') or '\\' in self.path or '\x00' in self.path:
                return self.reply(400, {'error': 'PATH_REJECTED'})
            if path.startswith('/native/'):
                return self.native_request(path, length)
            if path == '/healthz' and self.command == 'GET':
                try:
                    ready = bool(readiness and readiness())
                except Exception:
                    ready = False
                return self.reply(200 if ready else 503, {'ready': ready})
            token = self.bearer() if self.native_cors else self.token()
            if self.native_cors:
                status = {'state': 'approved'} if store.native_session_valid(token) else {'state': 'missing'}
            else:
                status = store.status(token)
            if path == '/auth' and self.command == 'GET':
                return self.reply(200, AUTH_HTML, 'text/html; charset=utf-8')
            if path == '/auth.js' and self.command == 'GET':
                return self.reply(200, AUTH_JS, 'application/javascript')
            if path == '/auth/status' and self.command == 'GET':
                # A successful operator approval can outlive the initial pending
                # cookie. Align the cookie to the remaining absolute server grant;
                # reading status never extends the authorization in the store.
                cookie = None
                if status['state'] == 'approved':
                    remaining = max(0, int(status['expiresAt'] - time.time()))
                    cookie = f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={remaining}' + ('; Secure' if secure else '')
                return self.reply(200, status, cookie=cookie)
            if path == '/auth/request' and self.command == 'POST':
                self.rfile.read(length)
                if status['state'] in ('pending', 'approved'):
                    return self.reply(200, status)
                try:
                    token, code = store.request()
                except ValueError:
                    return self.reply(429, {'error': 'PAIRING_LIMIT'})
                cookie = f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400' + ('; Secure' if secure else '')
                return self.reply(201, {'state': 'pending', 'code': code}, cookie=cookie)
            if path == '/signout-with-chatgpt' and self.command == 'GET':
                if status.get('code'):
                    store.revoke(status['code'])
                return self.reply(200, AUTH_HTML, 'text/html; charset=utf-8', f'{COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + ('; Secure' if secure else ''))
            if status['state'] != 'approved':
                if path == '/' and self.command == 'GET':
                    self.send_response(303)
                    self.send_header('Location', '/auth')
                    self.security_headers()
                    self.end_headers()
                    return
                return self.reply(401, {'error': 'DEVICE_APPROVAL_REQUIRED'})
            connection = http.client.HTTPConnection('127.0.0.1', worker_port, timeout=240)
            try:
                connection.request(self.command, self.path, body=self.rfile.read(length) if length else None, headers=proxy_headers(self.headers, internal_token, worker_origin))
                upstream = connection.getresponse()
                still_approved = store.native_session_valid(token) if self.native_cors else store.status(token)['state'] == 'approved'
                if not still_approved:
                    return self.reply(403, {'error': 'DEVICE_REVOKED'})
                self.send_response(upstream.status)
                skip = {'connection', 'transfer-encoding', 'set-cookie', 'server', 'date', 'cache-control', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'x-content-type-options', 'vary'}
                for name, value in upstream.getheaders():
                    if name.lower() not in skip and not name.lower().startswith('access-control-'):
                        self.send_header(name, value)
                self.security_headers()
                self.end_headers()
                while chunk := upstream.read(65536):
                    self.wfile.write(chunk)
            except (OSError, http.client.HTTPException):
                self.close_connection = True  # uncertain app writes are not retried
            finally:
                connection.close()

        do_GET = handle_request
        do_POST = handle_request
        do_PUT = handle_request
        do_DELETE = handle_request
        do_OPTIONS = handle_request

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=DEFAULT_STATE)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('pending')
    approve = commands.add_parser('approve')
    approve.add_argument('code')
    approve.add_argument('--hours', type=float, default=None, help='Explicit duration; shared default 12h/max 24h, personal default/max 30 days.')
    approve.add_argument('--personal', action='store_true', help='Explicit operator confirmation of a personal device, not a browser-supplied claim.')
    revoke = commands.add_parser('revoke')
    revoke.add_argument('code')
    args = parser.parse_args()
    state = args.state.resolve()
    if not state.is_relative_to(ROOT / '.sites-runtime'):
        parser.error('State must be under this Project .sites-runtime')
    store = AuthStore(state)
    if args.action == 'pending':
        print(json.dumps(store.pending()))
    elif args.action == 'approve':
        store.approve(args.code, args.hours, personal=args.personal)
        hours = (30 * 24 if args.personal else 12) if args.hours is None else args.hours
        print(json.dumps({'approvedDevice': args.code, 'hours': hours, 'deviceKind': 'personal' if args.personal else 'shared'}))
    else:
        store.revoke(args.code)
        print(json.dumps({'revokedDevice': args.code}))


if __name__ == '__main__':
    main()

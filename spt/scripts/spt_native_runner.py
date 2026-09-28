#!/usr/bin/env python3
"""Run one bounded, independent SPT backend using the verified Worker/Native path.

No daemon installation, public listener, tunnel, profile switch or native config
write. --native requires separately admitted existing reader selection. --run
owns its loopback listeners and stops them on signal or its explicit deadline.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import signal
import sqlite3
import socket
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


backend = module('spt_backend', 'spt-backend.py')
analysis = module('spt_analysis_packet', 'spt-native-analysis.py')
audio_import = module('spt_audio_import', 'spt_audio_import.py')


def bundle_identity(bundle: Path):
    digest = hashlib.sha256()
    count = 0
    for path in sorted(bundle.rglob('*')):
        if path.is_symlink():
            raise ValueError('BUNDLE_SYMLINK_REJECTED')
        if path.is_file():
            digest.update(path.relative_to(bundle).as_posix().encode() + b'\0')
            digest.update(hashlib.sha256(path.read_bytes()).digest())
            count += 1
    if not count:
        raise ValueError('EMPTY_BUNDLE')
    return 'spt-' + digest.hexdigest()


def sheet_bridge_bindings(url: str, owner: str, key: str | None):
    """Separate public settings from a single memory-only native credential."""
    if not isinstance(url, str) or not re.fullmatch(r'https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec', url):
        raise ValueError('SHEET_BRIDGE_URL_REJECTED')
    if not isinstance(owner, str) or not re.fullmatch(r'native-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', owner):
        raise ValueError('SHEET_BRIDGE_OWNER_REJECTED')
    if not isinstance(key, str) or not 32 <= len(key) <= 1024 or re.search(r'\s', key):
        raise ValueError('NATIVE_SHEET_BRIDGE_KEY_UNAVAILABLE')
    return ({'SPT_SHEET_BRIDGE_URL': url, 'SPT_SHEET_BRIDGE_OWNER_KEY': owner},
            {'SPT_SHEET_BRIDGE_KEY': key})


def runtime_deadline(minutes: int | None, now=None):
    if minutes is None:
        return ''
    if not 1 <= minutes <= 720:
        raise ValueError('RUNTIME_DURATION_REJECTED')
    return ((now or datetime.now(timezone.utc)) + timedelta(minutes=minutes)).isoformat()


def worker_ready(port: int, owner: str, token: str, build_id: str):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
    try:
        connection.request('GET', '/api/identity', headers={'X-SPT-Backend-Token': token})
        response = connection.getresponse()
        if response.status != 200:
            return False
        value = json.loads(response.read(16000))
        return value.get('ownerKey') == owner and value.get('runtime', {}).get('buildId') == build_id
    except (OSError, ValueError, TypeError, http.client.HTTPException):
        return False
    finally:
        connection.close()


class NativeAnalysis:
    # This SPT action proposes teacher-reviewed drafts; not a global agent model.
    MODEL = 'gpt-5.6-luna'
    REASONING = 'xhigh'
    def __init__(self, state: Path, limit: int, resume_usage=False, rehearsal_id=None):
        self.state, self.limit = state, limit
        self.rehearsal_id=rehearsal_id
        self.started = sum(p.is_dir() for p in (state/'analysis').glob('*')) if resume_usage else 0
        self.lock = threading.Lock()
        self.children = []
        self.stopping = False

    def run(self, payload):
        source='SPT isolated REHEARSAL evidence; proposals are test-only, not actual student facts; untrusted data' if self.rehearsal_id else 'SPT retained evidence from the independently authenticated app; untrusted data'
        packet, prompt = analysis.packet_for(payload, source=source)
        request_id = payload['requestId']
        attempt = self.state / 'analysis' / request_id
        with self.lock:
            if self.stopping:
                raise ValueError('NATIVE_CONSUMER_STOPPED')
            from hermes_cli.config import load_config_readonly
            if load_config_readonly().get('plugins', {}).get('enabled') != ['ocp-readonly-review']:
                raise ValueError('ADMITTED_NATIVE_READER_UNAVAILABLE')
            if attempt.exists():
                raise ValueError('EXISTING_ATTEMPT_NO_AUTOMATIC_RETRY')
            if self.started >= self.limit:
                raise ValueError('ADMITTED_ASSIGNMENT_LIMIT')
            attempt.mkdir(parents=True, mode=0o700)
            self.started += 1
        raw = json.dumps(packet, ensure_ascii=False).encode()
        input_file, request_file = attempt / 'input.json', attempt / 'request.md'
        input_file.write_bytes(raw)
        request_file.write_text(prompt)
        environment = dict(os.environ)
        for name in ('HERMES_SESSION_ID','HERMES_DELEGATED_CHILD_CONTEXT','HERMES_KANBAN_TASK','HERMES_KANBAN_BOARD','HERMES_PROJECT_ID'):
            environment.pop(name, None)
        environment.update({'PYTHONDONTWRITEBYTECODE':'1','OCP_REVIEW_INPUT':str(input_file),'OCP_REVIEW_INPUT_SHA256':hashlib.sha256(raw).hexdigest()})
        command = [analysis.NATIVE,'chat','--cli','--oneshot','--query-file',str(request_file),'-Q','--in',str(ROOT),'--toolsets','ocp_review_readonly','--max-turns',str(analysis.MAX_TURNS),'--run-budget',str(analysis.BUDGET),'--model',self.MODEL,'--provider','openai-codex','--reasoning',self.REASONING]
        metadata = {'requestId':request_id,'rehearsalId':self.rehearsal_id,'route':'native-hermes-cli-agent','requestedModel':self.MODEL,'reasoningEffort':self.REASONING,'provider':'openai-codex','toolset':'ocp_review_readonly','maxTurns':analysis.MAX_TURNS,'budgetSeconds':analysis.BUDGET,'automaticRetry':False,'cost':'unknown'}
        child = None
        try:
            with self.lock:
                if self.stopping:
                    raise ValueError('NATIVE_CONSUMER_STOPPED')
                child = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
                self.children.append(child)
            try:
                stdout, stderr = child.communicate(timeout=analysis.BUDGET + 45)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    stdout, stderr = child.communicate(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    stdout, stderr = child.communicate(timeout=15)
                (attempt / 'native.stdout').write_text(stdout)
                (attempt / 'native.stderr').write_text(stderr)
                raise ValueError('NATIVE_TIMEOUT_UNKNOWN')
            (attempt / 'native.stdout').write_text(stdout)
            (attempt / 'native.stderr').write_text(stderr)
            metadata['exitCode'] = child.returncode
            ids = re.findall(r'\b\d{8}_\d{6}_[0-9a-f]{6}\b', stdout + '\n' + stderr)
            metadata['sessionId'] = ids[-1] if ids else None
            if child.returncode != 0:
                raise ValueError('NATIVE_FAILED_UNKNOWN')
            answer = {'native':metadata,'output':analysis.final_payload(stdout)}
            (attempt / 'result.json').write_text(json.dumps(answer, ensure_ascii=False))
            return answer
        except (OSError, ValueError) as error:
            metadata['state'] = 'unknown'
            metadata['errorType'] = type(error).__name__
            (attempt / 'result.json').write_text(json.dumps({'native':metadata}))
            raise ValueError('NATIVE_RESULT_UNKNOWN') from None

    def stop(self):
        with self.lock:
            self.stopping = True
            children = list(self.children)
        for child in children:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
        for child in children:
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=15)


def native_handler(runner, owner, token, importer=None, allow_analysis=True, academy=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            code = 200
            if self.path not in ('/analyze','/audio-import','/academy') or self.path=='/analyze' and not allow_analysis or self.path=='/audio-import' and importer is None or self.path=='/academy' and academy is None or self.headers.get('X-SPT-Owner') != owner or not hmac.compare_digest(self.headers.get('Authorization',''), 'Bearer ' + token):
                code, answer = 403, {'error':'BOUND_CALLER_REQUIRED'}
            else:
                try:
                    size = int(self.headers.get('Content-Length','0'))
                    if not 0 < size <= 160000:
                        raise ValueError('INPUT_LIMIT')
                    payload=json.loads(self.rfile.read(size))
                    if self.path=='/analyze':
                        answer=runner.run(payload)
                    elif self.path=='/academy':
                        answer=academy.handle(payload)
                    else:
                        if payload=={'action':'capabilities'}:
                            answer=importer.capabilities()
                        else:
                            if not isinstance(payload,dict) or set(payload) not in ({'importId','attemptId','recover'},{'importId','attemptId','recover','operation'}) or not isinstance(payload['recover'],bool) or payload.get('operation','finalize') not in ('finalize','transcribe'):
                                raise ValueError('IMPORT_INPUT_REJECTED')
                            answer=importer.process(payload['importId'],payload['attemptId'],payload['recover'],operation=payload.get('operation','finalize'))
                except (ValueError, TypeError, KeyError, OSError):
                    code, answer = 502, {'error':'NATIVE_RESULT_UNKNOWN'}
            raw = json.dumps(answer, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
    return Handler


def rehearsal_options(*, run_id, state, origin, owner, analyses, transcriptions, class_date, student_ids, private_test=False):
    """Explicit full-cycle mode; the older no-provider fixture stays restricted."""
    if private_test or not isinstance(run_id,str) or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',run_id):
        raise ValueError('REHEARSAL_RUN_INVALID')
    if state.resolve()!=ROOT/'.sites-runtime/backend-private'/('rehearsal-'+run_id) or origin!='https://qa-spt.kcpalantir.tech':
        raise ValueError('REHEARSAL_ISOLATION_REQUIRED')
    if not isinstance(owner,str) or not re.fullmatch(r'native-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',owner):
        raise ValueError('REHEARSAL_OWNER_INVALID')
    if not 1<=analyses<=3 or not 0<=transcriptions<=3:
        raise ValueError('REHEARSAL_BUDGET_REQUIRED')
    if not isinstance(class_date,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',class_date) or datetime.strptime(class_date,'%Y-%m-%d').strftime('%Y-%m-%d')!=class_date:
        raise ValueError('REHEARSAL_DATE_INVALID')
    if not isinstance(student_ids,list) or not 1<=len(student_ids)<=3 or any(not isinstance(s,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}',s) for s in student_ids) or len(set(student_ids))!=len(student_ids):
        raise ValueError('REHEARSAL_STUDENTS_INVALID')
    return {'run_id':run_id,'owner':owner,'ports':(4179,4182,4183),'max_file_seconds':120,'date':class_date,'student_ids':student_ids}


def workbench_options(*, run_id, state, origin, class_date, student_ids, private_test=False):
    """Provider-free synthetic scope owned by one Workbench run."""
    if not private_test or not isinstance(run_id,str) or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',run_id):
        raise ValueError('WORKBENCH_RUN_INVALID')
    if state.resolve()!=ROOT/'.sites-runtime/backend-private'/('workbench-'+run_id) or origin!='http://127.0.0.1:4183':
        raise ValueError('WORKBENCH_ISOLATION_REQUIRED')
    if not isinstance(class_date,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',class_date) or datetime.strptime(class_date,'%Y-%m-%d').strftime('%Y-%m-%d')!=class_date:
        raise ValueError('WORKBENCH_DATE_INVALID')
    if not isinstance(student_ids,list) or not 1<=len(student_ids)<=3 or any(not isinstance(s,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}',s) for s in student_ids) or len(set(student_ids))!=len(student_ids):
        raise ValueError('WORKBENCH_STUDENTS_INVALID')
    return {'run_id':run_id,'ports':(4179,4182,4183),'date':class_date,'student_ids':student_ids}


def rehearsal_owner_ready(owner):
    path=ROOT/'.sites-runtime/backend-private/classroom/device-auth.sqlite'
    if not path.is_file():return False
    with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as db:
        return db.execute('SELECT owner FROM account WHERE id=1').fetchone()==(owner,)


def retire_rehearsal(state, run_id, ports_available=None):
    """Retire only a stopped run; keep its private originals, revoke its devices."""
    if not isinstance(run_id,str) or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',run_id):
        raise ValueError('REHEARSAL_RUN_INVALID')
    expected=ROOT/'.sites-runtime/backend-private'/('rehearsal-'+run_id)
    if state.resolve()!=expected or not (state/'rehearsal.json').is_file() or (state/'retired-rehearsal.json').exists():
        raise ValueError('REHEARSAL_RESET_SCOPE')
    if ports_available is None:
        def ports_available():
            for port in (4179,4182,4183):
                with socket.socket() as connection:
                    if connection.connect_ex(('127.0.0.1',port))==0:return False
            return True
    if not ports_available():raise ValueError('STOP_REHEARSAL_BEFORE_RESET')
    binding=json.loads((state/'rehearsal.json').read_text())
    if binding.get('run_id')!=run_id:raise ValueError('REHEARSAL_BINDING_CHANGED')
    archive=ROOT/'.sites-runtime/backend-private/rehearsal-archive'/run_id
    if archive.exists():raise ValueError('REHEARSAL_ARCHIVE_EXISTS')
    store=backend.AuthStore(state,owner=binding['owner'])
    with store.connect() as db:codes=[r['code'] for r in db.execute('SELECT code FROM devices WHERE revoked=0')]
    for code in codes:store.revoke(code)
    archive.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    state.rename(archive)
    state.mkdir(mode=0o700)
    result={'run_id':run_id,'reset':'retired','archive':str(archive),'activeDataPresent':False,'devicesRevoked':len(codes),'originalsRetained':True}
    (state/'retired-rehearsal.json').write_text(json.dumps(result,indent=2))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--run', action='store_true')
    mode.add_argument('--serve', action='store_true', help='Explicit continuous app mode; native recovery owns its lifecycle, not a chat deadline.')
    mode.add_argument('--reset-rehearsal', action='store_true', help='After owned stop: revoke only this run devices and archive its private data; never reset production.')
    parser.add_argument('--origin', default='http://127.0.0.1:4177')
    parser.add_argument('--state', type=Path, default=ROOT / '.sites-runtime/backend-private')
    parser.add_argument('--bundle', type=Path, default=ROOT / 'dist')
    parser.add_argument('--minutes', type=int, default=30)
    parser.add_argument('--native', action='store_true')
    parser.add_argument('--academy', action='store_true', help='Existing operating teacher only: reviewed diary fields, never report/save/send or credentials in Worker bindings.')
    parser.add_argument('--max-analyses', type=int, default=1)
    parser.add_argument('--max-file-transcriptions', type=int, default=0)
    parser.add_argument('--sheet-bridge-url', default='', help='Admitted original bridge URL; native key is read privately, never accepted in argv.')
    parser.add_argument('--private-test-ports', action='store_true', help='Isolated 4179/4182/4183 listeners; forbids native/provider calls.')
    parser.add_argument('--rehearsal-run', default='', help='Explicit isolated full-cycle run UUID; never uses the production data directory.')
    parser.add_argument('--rehearsal-owner', default='', help='Existing teacher actor ID only; no copied device credentials or identity reassignment.')
    parser.add_argument('--rehearsal-date', default='', help='Exact selected class date; original TEST writes stay inside it.')
    parser.add_argument('--rehearsal-students', nargs='+', default=[], help='Exact selected student IDs, at most three for this bounded rehearsal.')
    parser.add_argument('--workbench-synthetic-run', default='', help='Provider-free isolated Workbench run UUID on private test ports.')
    parser.add_argument('--workbench-date', default='', help='Declared synthetic Workbench class date.')
    parser.add_argument('--workbench-students', nargs='+', default=[], help='Declared synthetic Workbench student IDs, at most three.')
    args = parser.parse_args()
    if args.reset_rehearsal:
        if not args.rehearsal_run or args.native or args.academy or args.max_file_transcriptions or args.sheet_bridge_url or args.private_test_ports or args.rehearsal_owner or args.rehearsal_date or args.rehearsal_students or args.workbench_synthetic_run or args.workbench_date or args.workbench_students:
            parser.error('Reset takes only the exact stopped rehearsal state/run; no provider or binding overrides.')
        if Path(os.environ.get('HERMES_HOME','')).resolve()!=Path('/opt/data') or os.environ.get('HERMES_PROFILE','default') not in ('','default') or not os.environ.get('HERMES_SESSION_ID'):
            parser.error('Reset requires the current default-backend Lead.')
        print(json.dumps(retire_rehearsal(args.state,args.rehearsal_run)));return 0
    if args.private_test_ports and (args.native or args.max_file_transcriptions or args.sheet_bridge_url or args.academy):
        parser.error('Private port testing cannot run native analysis, provider transcription or original Sheet calls.')
    worker_port,processor_port,gateway_port=(4179,4182,4183) if args.private_test_ports else (4173,4176,4177)
    origin = backend.public_origin(f'http://127.0.0.1:{gateway_port}' if args.private_test_ports and args.origin=='http://127.0.0.1:4177' else args.origin)
    if not 1 <= args.minutes <= 720 or not 1 <= args.max_analyses <= 8:
        parser.error('Explicit bounds required: 1..720 minutes, 1..8 analyses.')
    if not 0<=args.max_file_transcriptions<=8:
        parser.error('File STT requires an explicit 0..8 call limit; default is no provider calls.')
    state = args.state.resolve()
    if args.academy and (args.rehearsal_run or state!=ROOT/'.sites-runtime/backend-private/classroom' or origin!='https://spt.kcpalantir.tech'):
        parser.error('Academy input is restricted to the admitted existing operating app, not private tests or rehearsals.')
    rehearsal=None
    workbench=None
    if args.rehearsal_run:
        try:
            rehearsal=rehearsal_options(run_id=args.rehearsal_run,state=state,origin=origin,owner=args.rehearsal_owner,analyses=args.max_analyses,transcriptions=args.max_file_transcriptions,class_date=args.rehearsal_date,student_ids=args.rehearsal_students,private_test=args.private_test_ports)
        except ValueError as error:parser.error(str(error))
        worker_port,processor_port,gateway_port=rehearsal['ports']
    elif args.rehearsal_owner or args.rehearsal_date or args.rehearsal_students:
        parser.error('A rehearsal actor requires an explicit isolated run.')
    if args.workbench_synthetic_run:
        if args.rehearsal_run:
            parser.error('Workbench synthetic and rehearsal modes are separate.')
        try:
            workbench=workbench_options(run_id=args.workbench_synthetic_run,state=state,origin=origin,
                                        class_date=args.workbench_date,student_ids=args.workbench_students,
                                        private_test=args.private_test_ports)
        except ValueError as error:parser.error(str(error))
    elif args.workbench_date or args.workbench_students:
        parser.error('Workbench synthetic scope requires an explicit run.')
    bundle = args.bundle.resolve()
    if bundle != ROOT / 'dist' and not bundle.is_relative_to(ROOT / '.sites-runtime/releases'):
        parser.error('Bundle must be the project dist or a project-local versioned release.')
    if not state.is_relative_to(ROOT / '.sites-runtime/backend-private'):
        parser.error('State must remain in this Project backend-private namespace.')
    if Path(os.environ.get('HERMES_HOME','')).resolve() != Path('/opt/data') or os.environ.get('HERMES_PROFILE','default') not in ('','default'):
        parser.error('Default native profile required.')
    sys.path.insert(0,'/opt/hermes')
    from hermes_cli.config import load_config_readonly
    config = load_config_readonly()
    reader_ready = config.get('plugins',{}).get('enabled') == ['ocp-readonly-review']
    compiled = (bundle / 'server/index.js').is_file()
    if args.check:
        print(json.dumps({'compiled':compiled,'readerSelectionReady':reader_ready,'nativeRequested':args.native,'sheetBridgeSelected':bool(args.sheet_bridge_url),'origin':origin,'rehearsalId':args.rehearsal_run or None,'workbenchSyntheticId':args.workbench_synthetic_run or None,'rehearsalOwnerReady':rehearsal_owner_ready(args.rehearsal_owner) if rehearsal else None,'scope':'loopback app; no tunnel or service administration'}))
        return 0
    if not compiled or (args.native and not reader_ready):
        parser.error('Build or exact admitted existing reader selection is missing.')
    os.umask(0o077)
    if rehearsal and not rehearsal_owner_ready(rehearsal['owner']):
        parser.error('Existing teacher actor binding is not verified.')
    if (state/'retired-rehearsal.json').exists():
        parser.error('A retired rehearsal cannot be reopened as a fresh run.')
    store = backend.AuthStore(state,owner=rehearsal['owner'] if rehearsal else None)
    if any(p.name == '.env' or p.name.startswith('.env.') or p.name == '.dev.vars' or p.name.startswith('.dev.vars.') for p in state.iterdir()):
        raise RuntimeError('LOCAL_CREDENTIAL_OVERRIDE_REJECTED; no automatic deletion')
    runtime = json.loads((ROOT / 'backend/wrangler.json').read_text())
    runtime['main'] = str(bundle / 'server/index.js')
    runtime['assets']['directory'] = str(bundle / 'client')
    runtime['d1_databases'][0].update({'database_id':store.owner.removeprefix('native-'),'migrations_dir':str(ROOT / 'drizzle')})
    runtime['vars'].update({'SPT_BACKEND_OWNER_KEY':store.owner,'SPT_ELEVENLABS_OWNER_KEY':store.owner})
    synthetic=rehearsal or workbench
    if synthetic:
        runtime['vars'].update({'SPT_REHEARSAL_ID':synthetic['run_id'],'SPT_REHEARSAL_DATE':synthetic['date'],'SPT_REHEARSAL_STUDENTS':json.dumps(synthetic['student_ids'])})
        manifest=state/('rehearsal.json' if rehearsal else 'workbench-synthetic.json')
        binding={'run_id':synthetic['run_id'],'owner':store.owner,'origin':origin,'date':synthetic['date'],'student_ids':synthetic['student_ids'],'maxAnalyses':args.max_analyses if rehearsal else 0,'maxFileTranscriptions':args.max_file_transcriptions,'maxFileSeconds':120}
        if manifest.exists() and json.loads(manifest.read_text())!=binding:raise ValueError('REHEARSAL_BINDING_CHANGED')
        if not manifest.exists():manifest.write_text(json.dumps(binding,indent=2))
    build_id = bundle_identity(bundle)
    run_until = runtime_deadline(None if args.serve else args.minutes)
    runtime['vars'].update({'SPT_BUILD_ID':build_id,'SPT_RUN_UNTIL':run_until})
    internal_token, analysis_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    runtime['vars'].update({'SPT_CAPTURE_MODE':'voice_memos','SPT_AUDIO_IMPORT_OWNER_KEY':store.owner,'SPT_AUDIO_IMPORT_URL':f'http://127.0.0.1:{processor_port}/audio-import'})
    runtime['secrets']['required'].append('SPT_AUDIO_IMPORT_TOKEN')
    allowed = ('PATH','LANG','LC_ALL','TZ','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS')
    environment = {k:os.environ[k] for k in allowed if k in os.environ}
    environment.update({'SPT_BACKEND_SESSION_TOKEN':internal_token,'CLOUDFLARE_INCLUDE_PROCESS_ENV':'true','CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV':'true','WRANGLER_SEND_METRICS':'false','CI':'true','SITES_RUNTIME_ROOT':str(state / 'runtime')})
    environment['SPT_AUDIO_IMPORT_TOKEN']=analysis_token
    if args.academy:
        runtime['vars'].update({'SPT_ACADEMY_OWNER_KEY':store.owner,'SPT_ACADEMY_URL':f'http://127.0.0.1:{processor_port}/academy'})
        runtime['secrets']['required'].append('SPT_ACADEMY_TOKEN')
        environment['SPT_ACADEMY_TOKEN']=analysis_token
    if args.sheet_bridge_url:
        from hermes_cli.config import load_env, get_env_path
        if get_env_path().resolve() != Path('/opt/data/.env'):
            raise ValueError('NATIVE_SHEET_PROFILE_REJECTED')
        bridge_values, bridge_secrets = sheet_bridge_bindings(args.sheet_bridge_url, store.owner, load_env().get('SPT_SHEET_BRIDGE_KEY'))
        runtime['vars'].update(bridge_values)
        runtime['secrets']['required'].extend(bridge_secrets)
        environment.update(bridge_secrets)
    native_credentials=module('spt_native_elevenlabs','native-elevenlabs.py')
    key = None if args.private_test_ports else native_credentials.native_key()
    if key:
        module('spt_native_elevenlabs_validation','native-elevenlabs.py').worker_environment(key,{})
        environment['ELEVENLABS_API_KEY'] = key
        runtime['secrets']['required'].append('ELEVENLABS_API_KEY')
    if args.native:
        runtime['vars'].update({'SPT_NATIVE_ANALYSIS_OWNER_KEY':store.owner,'SPT_NATIVE_ANALYSIS_URL':f'http://127.0.0.1:{processor_port}/analyze'})
        runtime['secrets']['required'].append('SPT_NATIVE_ANALYSIS_TOKEN')
        environment['SPT_NATIVE_ANALYSIS_TOKEN'] = analysis_token
    runtime_config = state / 'wrangler.runtime.json'
    runtime_config.write_text(json.dumps(runtime,indent=2))  # configuration names only, never key values
    prefix = ['/usr/bin/bash','scripts/sites-env.sh','--','node_modules/.bin/wrangler']
    log = (state / 'worker.log').open('ab')
    migrated = subprocess.run(prefix+['d1','migrations','apply','DB','--config',str(runtime_config),'--local','--persist-to',str(state / 'state')],cwd=ROOT,env=environment,stdout=log,stderr=log,timeout=60)
    if migrated.returncode:
        log.close()
        raise RuntimeError('LOCAL_MIGRATIONS_FAILED; see private worker.log')
    runner = NativeAnalysis(state,args.max_analyses,resume_usage=bool(rehearsal),rehearsal_id=args.rehearsal_run or None)
    importer=audio_import.AudioImporter(state,store.owner,internal_token,(lambda:None) if args.private_test_ports else native_credentials.native_key,limit=args.max_file_transcriptions,worker_port=worker_port,max_seconds=rehearsal['max_file_seconds'] if rehearsal else audio_import.MAX_SECONDS,resume_usage=bool(rehearsal))
    servers = []
    academy=module('spt_academy','spt_academy.py').AcademyBridge(state,store.owner,internal_token,worker_port) if args.academy else None
    worker = None
    stopping = threading.Event()
    def stop():
        if stopping.is_set():
            return
        stopping.set()
        for server in servers:
            server.shutdown()
        runner.stop()
        importer.stop()
        if worker and worker.poll() is None:
            os.killpg(worker.pid,signal.SIGTERM)
    try:
        native = ThreadingHTTPServer(('127.0.0.1',processor_port),native_handler(runner,store.owner,analysis_token,importer,args.native,academy))
        servers.append(native)
        threading.Thread(target=native.serve_forever,daemon=True).start()
        gateway = ThreadingHTTPServer(('127.0.0.1',gateway_port),backend.handler_for(store,origin,worker_port,internal_token,readiness=lambda:worker_ready(worker_port,store.owner,internal_token,build_id)))
        servers.append(gateway)
        threading.Thread(target=gateway.serve_forever,daemon=True).start()
        worker = subprocess.Popen(prefix+['dev','--config',str(runtime_config),'--local','--ip','127.0.0.1','--port',str(worker_port),'--inspector-port','0','--persist-to',str(state / 'state'),'--log-level','error'],cwd=ROOT,env=environment,stdout=log,stderr=log,start_new_session=True)
        for sig in (signal.SIGTERM,signal.SIGINT):
            signal.signal(sig,lambda *_: threading.Thread(target=stop,daemon=True).start())
        if not args.serve:
            timer = threading.Timer(args.minutes*60,stop)
            timer.daemon = True
            timer.start()
        print(json.dumps({'gateway':f'http://127.0.0.1:{gateway_port}','publicOrigin':origin,'nativeEnabled':args.native,'analysisModel':NativeAnalysis.MODEL if args.native else None,'analysisReasoning':NativeAnalysis.REASONING if args.native else None,'sheetBridgeSelected':bool(args.sheet_bridge_url),'maxAnalyses':args.max_analyses if args.native else 0,'maxFileTranscriptions':args.max_file_transcriptions,'minutes':None if args.serve else args.minutes,'state':str(state),'providerCredentialPresent':bool(key),'buildId':build_id,'runUntil':run_until,'ready':'check HTTP separately'}),flush=True)
        return worker.wait()
    finally:
        stop()
        for server in servers:
            server.server_close()
        if worker:
            try:
                worker.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(worker.pid,signal.SIGKILL)
                worker.wait(timeout=15)
        log.close()


if __name__ == '__main__':
    raise SystemExit(main())

#!/usr/bin/env python3
"""One fixed SPT app/connector consumer for native no-agent cron.

Native cron owns scheduling. This module owns only SPT release/PID/readiness
metadata. It never restarts Hermes, kills a foreign listener or touches student
records directly. Public activation needs the independently verified DNS/token.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import socket
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

ROOT = Path('/opt/data/workspaces/spt')
HOME = Path('/opt/data')
CONFIG = ROOT / '.sites-runtime/classroom-runtime.json'
NATIVE_PYTHON = Path('/opt/hermes/.venv/bin/python')
CLOUDFLARED = ROOT / '.tools/cloudflared/2026.9.0/cloudflared'
BRIDGE = 'https://script.google.com/macros/s/AKfycbzZTx-QgKo5tJ1YrIZes-Ghc0Juit33rEEBFLzUeuYbxil9rnsoptnt7x1xuoX_ZhfGVQ/exec'
PRODUCTION_OWNER = 'native-0bd025d0-62c4-420a-92b5-594833dd692e'
SOURCE_FILES = ('scripts/spt_classroom_runtime.py', 'scripts/spt_native_runner.py',
                'scripts/spt-backend.py', 'scripts/spt_audio_import.py',
                'scripts/spt-native-analysis.py', 'scripts/native-elevenlabs.py',
                'backend/wrangler.json', 'scripts/sites-env.sh',
                'scripts/spt_academy.py', 'integrations/academy/students.json')
LEGACY_SOURCE_FILES = SOURCE_FILES[:-2]
FIELDS = {'schema', 'mode', 'origin', 'state', 'bundle', 'buildId', 'owner',
          'jobId', 'originRoot', 'sourceHashes', 'tunnelId'}


def validate_spec(raw):
    if not isinstance(raw, dict) or set(raw) != FIELDS or raw.get('schema') != 1:
        raise ValueError('RUNTIME_SPEC_SCHEMA')
    spec = dict(raw)
    if spec['mode'] not in ('private', 'production'):
        raise ValueError('RUNTIME_MODE')
    private = spec['mode'] == 'private'
    state, bundle = Path(spec['state']).resolve(), Path(spec['bundle']).resolve()
    expected_state = ROOT / '.sites-runtime/backend-private' / ('availability-qa' if private else 'classroom')
    if state != expected_state or not bundle.is_relative_to(ROOT / '.sites-runtime/releases'):
        raise ValueError('RUNTIME_PATH_SCOPE')
    origin = 'http://127.0.0.1:4183' if private else 'https://spt.kcpalantir.tech'
    if spec['origin'] != origin or not re.fullmatch(r'native-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', str(spec['owner'])):
        raise ValueError('RUNTIME_ORIGIN_OR_OWNER')
    if not private and spec['owner'] != PRODUCTION_OWNER:
        raise ValueError('RUNTIME_OWNER')
    if not re.fullmatch(r'spt-[0-9a-f]{64}', str(spec['buildId'])) or not re.fullmatch(r'[0-9a-f]{12}', str(spec['jobId'])):
        raise ValueError('RUNTIME_IDENTIFIERS')
    if not isinstance(spec['originRoot'], str) or not spec['originRoot']:
        raise ValueError('RUNTIME_AUTHORITY_ROOT')
    if private and spec['tunnelId'] or not private and not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', str(spec['tunnelId'])):
        raise ValueError('RUNTIME_TUNNEL_SCOPE')
    hashes = spec['sourceHashes']
    # A retained legacy spec remains inspectable/stoppable during an owned
    # transition. verify_release still requires the complete current pin set.
    if not isinstance(hashes, dict) or set(hashes) not in (set(SOURCE_FILES), set(LEGACY_SOURCE_FILES)) or any(not re.fullmatch(r'[0-9a-f]{64}', str(v)) for v in hashes.values()):
        raise ValueError('RUNTIME_SOURCE_BINDING')
    spec['state'], spec['bundle'] = str(state), str(bundle)
    return spec


def spec_digest(spec):
    return hashlib.sha256(json.dumps(spec, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def source_hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCE_FILES}


def app_command(spec):
    command = [str(NATIVE_PYTHON), '-B', str(ROOT / 'scripts/spt_native_runner.py'),
               '--serve', '--state', spec['state'], '--bundle', spec['bundle'],
               '--origin', spec['origin'], '--max-file-transcriptions', '0']
    if spec['mode'] == 'private':
        command.append('--private-test-ports')
    else:
        command += ['--sheet-bridge-url', BRIDGE, '--academy']
    return command


def runtime_environment(spec, parent, tunnel_token=None):
    names = ('PATH', 'LANG', 'LC_ALL', 'TZ', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
             'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS')
    env = {k: parent[k] for k in names if k in parent}
    env.update({'HERMES_HOME': str(HOME), 'HERMES_PROFILE': 'default',
                'PYTHONDONTWRITEBYTECODE': '1', 'HOME': str(Path(spec['state']) / 'process-home')})
    if tunnel_token is not None:
        if not isinstance(tunnel_token, str) or not 32 <= len(tunnel_token) <= 16384 or re.search(r'\s', tunnel_token):
            raise ValueError('TUNNEL_CREDENTIAL_UNAVAILABLE')
        env['TUNNEL_TOKEN'] = tunnel_token
    return env


def process_identity(pid):
    if not isinstance(pid, int) or pid <= 0:
        return None
    try:
        raw = Path(f'/proc/{pid}/stat').read_text()
        fields = raw[raw.rfind(')') + 2:].split()
        if fields[0] == 'Z':
            return None
        return {'pid': pid, 'start': fields[19], 'group': os.getpgid(pid)}
    except (OSError, ValueError, IndexError):
        return None


def process_alive(identity):
    return isinstance(identity, dict) and process_identity(identity.get('pid')) == identity


def lifecycle_decision(alive, ready, ports_free):
    return ('ready' if ready else 'degraded') if alive else ('start' if ports_free else 'blocked_ports')


def ports(spec):
    return (4179, 4182, 4183) if spec['mode'] == 'private' else (4173, 4176, 4177)


def ports_free(spec):
    for port in ports(spec):
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                return False
    return True


def verify_owner(state, owner):
    path = state / 'device-auth.sqlite'
    if not path.is_file():
        raise ValueError('RUNTIME_OWNER_STORE_MISSING')
    with sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True) as db:
        row = db.execute('SELECT owner FROM account WHERE id=1').fetchone()
    if row != (owner,):
        raise ValueError('RUNTIME_OWNER_MISMATCH')


def verify_release(spec):
    if source_hashes() != spec['sourceHashes']:
        raise ValueError('RUNTIME_SOURCE_CHANGED')
    path = ROOT / 'scripts/spt_native_runner.py'
    loader = importlib.util.spec_from_file_location('spt_runtime_identity', path)
    module = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(module)
    if module.bundle_identity(Path(spec['bundle'])) != spec['buildId']:
        raise ValueError('RUNTIME_RELEASE_CHANGED')
    verify_owner(Path(spec['state']), spec['owner'])


def ready(spec):
    request = urllib.request.Request(f'http://127.0.0.1:{ports(spec)[2]}/healthz',
                                     headers={'Host': urlsplit(spec['origin']).netloc})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status == 200 and json.load(response) == {'ready': True}
    except (OSError, ValueError, urllib.error.URLError):
        return False


def atomic_json(path, value):
    temporary = path.with_suffix('.pending')
    temporary.write_text(json.dumps(value, indent=2))
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def native_run_root(records, job_id, ancestors, started):
    candidates = [r for r in records if r.get('job_id') == job_id and r.get('status') == 'running'
                  and r.get('pid') in ancestors and r.get('process_started_at') is not None
                  and started.get(r['pid']) == r['process_started_at']
                  and re.fullmatch(r'[0-9a-f]{32}', str(r.get('id', '')))]
    if len(candidates) != 1:
        raise ValueError('RUNTIME_NATIVE_EXECUTION_UNRESOLVED')
    return candidates[0]['id']


def ancestor_pids():
    found, pid = set(), os.getppid()
    while pid > 0 and pid not in found:
        found.add(pid)
        try:
            text = Path(f'/proc/{pid}/stat').read_text()
            pid = int(text[text.rfind(')') + 2:].split()[1])
        except (OSError, ValueError, IndexError):
            break
    return found


def admit(spec, action):
    # Native identity metadata is a reader prerequisite, not a file lock. The
    # immutable source/build checks, app-control lock and port/PID guards below
    # independently protect the exact startup/stop target.
    sys.path.insert(0, '/opt/hermes')
    from hermes_cli.active_sessions import active_session_registry_snapshot
    from cron.executions import list_executions
    from gateway.status import get_process_start_time
    sessions = active_session_registry_snapshot(registry_home=str(HOME), strict=True)
    records = list_executions(job_id=spec['jobId'], limit=10)
    if action == 'stop-owned':
        execution_root = os.environ.get('HERMES_SESSION_ID')
        if not execution_root or not any(r['session_id'] == execution_root for r in sessions):
            raise ValueError('RUNTIME_NATIVE_LEAD_UNRESOLVED')
        root_kind = 'native-lead'
    else:
        ancestors = ancestor_pids()
        started = {pid: get_process_start_time(pid) for pid in ancestors}
        execution_root = native_run_root(records, spec['jobId'], ancestors, started)
        root_kind = 'native-no-agent-execution'
    # The v1 root field carries the verified execution root. A no-agent run has
    # an actual native execution record, NOT a new conversation or the authoring
    # Lead's lineage. The latter remains authorization provenance only.
    peers = sorted({r['session_id'] for r in sessions if r['session_id'] != execution_root})
    if not peers:
        fallback = spec['originRoot'] if spec['originRoot'] != execution_root else next((r['id'] for r in records if r.get('id') != execution_root), None)
        if not fallback:
            raise ValueError('RUNTIME_COMPARISON_ROOT_UNRESOLVED')
        peers = [fallback]
    native = {'access': 'NATIVE_SHARED', 'resource': {'kind': 'PROFILE_SESSION_METADATA', 'profile_id': 'default'}}
    claims = [native, {'access': 'WRITE', 'resource': {'kind': 'PATH', 'path': spec['state'], 'path_scope': 'TREE'}}]
    claims += [{'access': 'OWN', 'resource': {'kind': 'NETWORK_ENDPOINT', 'namespace': 'connected-backend-loopback', 'protocol': 'tcp', 'port': p}} for p in ports(spec)]
    unit = {'unit_id': 'spt-runtime-' + action + '-' + spec['jobId'], 'conversation_root_id': execution_root,
            'effectful': True, 'authorization_id': 'approved-spt-native-recovery-job:' + spec['jobId'], 'claims': claims}
    checks = []
    for peer in peers:
        envelope = {'schema_version': 'ocp.resource-execution-envelope.v1', 'units': [unit,
                    {'unit_id': 'native-metadata-observation-' + peer, 'conversation_root_id': peer,
                     'effectful': False, 'authorization_id': None, 'claims': [native]}]}
        result = subprocess.run(['/opt/data/workspaces/ocp-neutral-dev/.venv/bin/python', '-B', '-m', 'resource_classifier'],
                                cwd='/opt/data/workspaces/ocp-neutral-dev', input=json.dumps(envelope),
                                text=True, capture_output=True, timeout=15)
        if result.returncode:
            raise ValueError('RUNTIME_CLASSIFIER_REFUSED')
        value = json.loads(result.stdout)
        if value['classification'] in ('HARD_CONFLICT', 'CLAIM_INCOMPLETE'):
            raise ValueError('RUNTIME_WRITER_CONFLICT')
        checks.append({'envelope': envelope, 'result': value})
    atomic_json(Path(spec['state']) / 'last-runtime-admission.json', {'action': action, 'rootBinding': {'kind': root_kind, 'id': execution_root, 'authorizationOrigin': spec['originRoot']}, 'checks': checks})


def launch(spec, command, role, token=None):
    state = Path(spec['state'])
    with (state / (role + '-runtime.log')).open('ab') as log:
        child = subprocess.Popen(command, cwd=ROOT, env=runtime_environment(spec, os.environ, token),
                                 stdout=log, stderr=log, start_new_session=True, close_fds=True)
    identity = process_identity(child.pid)
    if identity is None or identity['group'] != child.pid:
        raise ValueError('RUNTIME_CHILD_IDENTITY_UNAVAILABLE')
    return identity


def production_token(spec):
    sys.path.insert(0, '/opt/hermes')
    from hermes_cli.config import load_env, get_env_path
    if get_env_path().resolve() != HOME / '.env':
        raise ValueError('RUNTIME_NATIVE_PROFILE_MISMATCH')
    selected = load_env()
    token = selected.get('SPT_CLOUDFLARE_TUNNEL_TOKEN')
    runtime_environment(spec, {}, token if token is not None else '')
    if not selected.get('SPT_SHEET_BRIDGE_KEY') or not CLOUDFLARED.is_file():
        raise ValueError('RUNTIME_PUBLIC_PREREQUISITE_MISSING')
    return token


def tick(spec, stop=False):
    state = Path(spec['state'])
    if not state.is_dir():
        raise ValueError('RUNTIME_STATE_NOT_PREPARED')
    os.umask(0o077)
    with (state / 'runtime-control.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'state': 'busy'}, False
        path = state / 'runtime-control.json'
        current = json.loads(path.read_text()) if path.exists() else {'roles': {}}
        roles = current['roles']
        digest = spec_digest(spec)
        if current.get('spec') not in (None, digest) and any(process_alive(r) for r in roles.values()):
            raise ValueError('RUNTIME_ACTIVE_SPEC_CHANGED')
        if stop:
            admit(spec, 'stop-owned')
            for identity in roles.values():
                if process_alive(identity):
                    if identity['group'] != identity['pid']:
                        raise ValueError('RUNTIME_NOT_OWNED_GROUP')
                    os.killpg(identity['pid'], signal.SIGTERM)
            answer = {'state': 'stopping', 'mode': spec['mode']}
        else:
            alive = process_alive(roles.get('app'))
            decision = lifecycle_decision(alive, ready(spec) if alive else False, ports_free(spec))
            started = False
            needs_connector = spec['mode'] == 'production' and not process_alive(roles.get('connector'))
            if decision == 'start' or alive and needs_connector:
                verify_release(spec)
                token = production_token(spec) if spec['mode'] == 'production' else None
                admit(spec, 'start-owned')
                if json.loads(CONFIG.read_text()) != spec:
                    raise ValueError('RUNTIME_SPEC_CHANGED_BEFORE_START')
                if decision == 'start':
                    if not ports_free(spec):
                        raise ValueError('RUNTIME_PORTS_CHANGED')
                    roles['app'] = launch(spec, app_command(spec), 'app')
                    atomic_json(path, {'spec': digest, 'roles': roles, 'status': {'state': 'starting_app'}})
                    started = True
                if needs_connector:
                    roles['connector'] = launch(spec, [str(CLOUDFLARED), 'tunnel', '--no-autoupdate', 'run', spec['tunnelId']], 'connector', token)
                    atomic_json(path, {'spec': digest, 'roles': roles, 'status': {'state': 'starting_connector'}})
                    started = True
            answer = {'state': 'starting' if started else decision, 'mode': spec['mode'],
                      'appPid': roles.get('app', {}).get('pid'), 'connectorPid': roles.get('connector', {}).get('pid')}
        changed = current.get('status') != answer
        if changed or current.get('spec') != digest:
            atomic_json(path, {'spec': digest, 'roles': roles, 'status': answer})
        return answer, changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stop-owned', action='store_true')
    parser.add_argument('--inspect', action='store_true')
    args = parser.parse_args()
    spec = validate_spec(json.loads(CONFIG.read_text()))
    if args.inspect:
        print(json.dumps({'mode': spec['mode'], 'origin': spec['origin'], 'buildId': spec['buildId'], 'jobId': spec['jobId']}))
        return 0
    answer, changed = tick(spec, stop=args.stop_owned)
    if changed:
        print(json.dumps(answer))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        # No key values, command environments or provider response bodies.
        print(json.dumps({'state': 'blocked', 'reason': str(error) if isinstance(error, ValueError) else type(error).__name__}))
        raise SystemExit(1)

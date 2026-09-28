#!/usr/bin/env python3
"""Reuse the default profile's native ElevenLabs key without exporting it.

Run with the installed Hermes Python. --check emits presence only, not provider
validation. --run starts one owned loopback SPT Worker with a memory-only key.
No native writes, model calls, production bindings, credential argv or key copies.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NATIVE_HOME = Path('/opt/data')
KEY_NAME = 'ELEVENLABS_API_KEY'


class ConnectionSetupError(Exception):
    pass


def worker_environment(key: str | None, inherited: dict[str, str]) -> dict[str, str]:
    if not isinstance(key, str) or not 16 <= len(key) <= 1024 or re.search(r'\s', key):
        raise ConnectionSetupError('Register a valid ELEVENLABS_API_KEY in the default profile API Keys. The value is not logged.')
    # Only runtime transport/toolchain settings are inherited. Never forward the
    # Hermes OAuth/dashboard credentials or other model/provider credentials.
    names = ('PATH', 'LANG', 'LC_ALL', 'TZ', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
             'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
             'NODE_EXTRA_CA_CERTS')
    environment = {name: inherited[name] for name in names if name in inherited}
    environment.update({
        'PATH': environment.get('PATH', '/usr/local/bin:/usr/bin:/bin'),
        'ELEVENLABS_API_KEY': key,
        'CLOUDFLARE_INCLUDE_PROCESS_ENV': 'true',
        'CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV': 'true',
        'WRANGLER_SEND_METRICS': 'false',
        'CI': 'true',
    })
    return environment


def worker_command() -> list[str]:
    return [
        '/usr/bin/bash', 'scripts/sites-env.sh', '--', 'node_modules/.bin/wrangler',
        'dev', '--config', 'tests/native-live/wrangler.json', '--local',
        '--ip', '127.0.0.1', '--port', '4175', '--inspector-port', '0',
        '--persist-to', '.sites-runtime/native-live/state', '--log-level', 'error',
    ]


def public_status(present: bool) -> dict[str, object]:
    return {
        'profile': 'default', 'credential_name': KEY_NAME,
        'credential_state': 'present_unverified' if present else 'missing',
        'consumer': 'SPT owner-bound private Worker',
        'origin': 'http://127.0.0.1:4175',
        'storage': '.sites-runtime/native-live/state',
        'provider_call_performed': False,
    }


def native_key() -> str | None:
    if os.environ.get('HERMES_PROFILE', 'default') not in ('', 'default'):
        raise ConnectionSetupError('This connection belongs to the default profile only.')
    # Use the same native canonical store as the API Keys page, not a raw file
    # reader or an inherited-shell fallback. Removal must not resurrect a stale
    # shell key. Native parsing happens privately in this consumer process.
    from hermes_cli.config import get_env_path, load_env
    if get_env_path().resolve() != NATIVE_HOME / '.env':
        raise ConnectionSetupError('Unexpected native profile home; no credential was transferred.')
    return load_env().get(KEY_NAME)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Presence/format check only; no API request')
    mode.add_argument('--run', action='store_true', help='Explicitly start the owned local live-test app')
    args = parser.parse_args()
    try:
        key = native_key()
        if not key:
            print(json.dumps(public_status(False)))
            return 78
        environment = worker_environment(key, dict(os.environ))
        if not args.run:
            print(json.dumps(public_status(True)))
            return 0
        config_path = ROOT / 'tests/native-live/wrangler.json'
        config = json.loads(config_path.read_text())
        if config.get('secrets', {}).get('required') != [KEY_NAME]:
            raise ConnectionSetupError('The Worker secret binding must allow only ELEVENLABS_API_KEY.')
        if config.get('dev', {}).get('ip') != '127.0.0.1':
            raise ConnectionSetupError('A non-loopback live-test listener is not allowed.')
        # Local override files could supersede the canonical in-memory key.
        if any(p.name == '.env' or p.name.startswith('.env.') or p.name == '.dev.vars' or p.name.startswith('.dev.vars.') for p in config_path.parent.iterdir()):
            raise ConnectionSetupError('Remove the conflicting local secret source deliberately before launch; no automatic deletion is performed.')
        print(json.dumps(public_status(True)), flush=True)
        os.chdir(ROOT)
        command = worker_command()
        os.execve(command[0], command, environment)
    except ConnectionSetupError as error:
        print(json.dumps({'credential_state': 'unavailable', 'error': str(error)}))
        return 78
    except Exception as error:
        # Native parser/OS errors may contain sensitive values; expose type only.
        print(json.dumps({'credential_state': 'unavailable', 'error_type': type(error).__name__}))
        return 70
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

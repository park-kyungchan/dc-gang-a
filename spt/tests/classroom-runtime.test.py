"""Private runtime control contracts. Synthetic specs and process doubles only."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('spt_classroom_runtime', ROOT / 'scripts/spt_classroom_runtime.py')


class ClassroomRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(cls.runtime)

    def spec(self):
        return {'schema': 1, 'mode': 'private', 'origin': 'http://127.0.0.1:4183',
                'state': str(self.runtime.ROOT / '.sites-runtime/backend-private/availability-qa'),
                'bundle': str(self.runtime.ROOT / '.sites-runtime/releases/classroom-availability-01'),
                'buildId': 'spt-' + 'a' * 64,
                'owner': 'native-11111111-1111-4111-8111-111111111111',
                'jobId': '111111111111', 'originRoot': 'fixture-authorized-origin',
                'sourceHashes': {name: 'b' * 64 for name in self.runtime.SOURCE_FILES},
                'tunnelId': ''}

    def test_private_command_is_continuous_and_cannot_reach_providers_or_original_sheet(self):
        spec = self.runtime.validate_spec(self.spec())
        command = self.runtime.app_command(spec)
        self.assertIn('--serve', command)
        self.assertIn('--private-test-ports', command)
        for bad in ('--native', '--sheet-bridge-url', '--minutes', '--remote', '--academy'):
            self.assertNotIn(bad, command)
        self.assertEqual(command[command.index('--max-file-transcriptions') + 1], '0')

    def test_legacy_spec_remains_stoppable_but_cannot_start_changed_unpinned_source(self):
        spec=self.spec();spec['sourceHashes']={k:v for k,v in spec['sourceHashes'].items() if k in self.runtime.LEGACY_SOURCE_FILES}
        self.runtime.validate_spec(spec)
        # Keep this isolated from the operating workspace and its excluded academy fixture.
        current = {name: 'b' * 64 for name in self.runtime.SOURCE_FILES}
        with patch.object(self.runtime, 'source_hashes', return_value=current):
            with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):
                self.runtime.verify_release(spec)

    def test_unapproved_paths_origins_and_identity_formats_fail_closed(self):
        bad_values = [('state', '/tmp/not-spt'), ('bundle', str(self.runtime.ROOT / 'dist')),
                      ('origin', 'https://foreign.example'), ('owner', 'siwc-' + 'a' * 64),
                      ('jobId', 'not-a-native-job'), ('tunnelId', '11111111-1111-4111-8111-111111111111')]
        for key, value in bad_values:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.runtime.validate_spec({**self.spec(), key: value})

    def test_only_explicit_runtime_settings_and_selected_tunnel_secret_are_forwarded(self):
        parent = {'PATH': '/bin', 'LANG': 'C', 'HOME': '/not-owned', 'OPENAI_API_KEY': 'SYNTHETIC-NO',
                  'HERMES_SESSION_ID': 'not-the-cron-owner', 'HERMES_DASHBOARD_TOKEN': 'SYNTHETIC-NO'}
        spec = self.runtime.validate_spec(self.spec())
        env = self.runtime.runtime_environment(spec, parent)
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertNotIn('HERMES_DASHBOARD_TOKEN', env)
        self.assertNotIn('HERMES_SESSION_ID', env)
        self.assertEqual(env['HERMES_HOME'], '/opt/data')
        self.assertNotEqual(env['HOME'], parent['HOME'])
        token = 'SYNTHETIC-CLOUDFLARE-TUNNEL-TOKEN-0123456789'
        tunnel_env = self.runtime.runtime_environment(spec, parent, tunnel_token=token)
        self.assertEqual(tunnel_env['TUNNEL_TOKEN'], token)
        self.assertNotIn(token, json.dumps(spec))
        with self.assertRaises(ValueError):
            self.runtime.runtime_environment(spec, parent, tunnel_token=token + '\n')

    def test_process_identity_rejects_pid_reuse_without_reading_command_arguments(self):
        identity = self.runtime.process_identity(os.getpid())
        self.assertIsNotNone(identity)
        self.assertTrue(self.runtime.process_alive(identity))
        self.assertFalse(self.runtime.process_alive({**identity, 'start': identity['start'] + '-old'}))
        self.assertFalse(self.runtime.process_alive({'pid': -1, 'start': '1', 'group': -1}))

    def test_start_decision_never_steals_ports_or_restarts_a_live_degraded_process(self):
        decide = self.runtime.lifecycle_decision
        self.assertEqual(decide(True, True, True), 'ready')
        self.assertEqual(decide(True, False, True), 'degraded')
        self.assertEqual(decide(False, False, True), 'start')
        self.assertEqual(decide(False, False, False), 'blocked_ports')

    def test_admission_uses_verified_native_run_identity_not_authoring_conversation(self):
        record = {'id': 'a' * 32, 'job_id': self.spec()['jobId'], 'status': 'running',
                  'pid': 1234, 'process_started_at': 5678}
        actual = self.runtime.native_run_root([record], self.spec()['jobId'], {1234}, {1234: 5678})
        self.assertEqual(actual, record['id'])
        self.assertNotEqual(actual, self.spec()['originRoot'])
        for changed in ({'status': 'failed'}, {'pid': 4321}, {'process_started_at': 9999}, {'job_id': 'b' * 12}, {'id': 'not-native'}):
            with self.subTest(change=changed), self.assertRaises(ValueError):
                self.runtime.native_run_root([{**record, **changed}], self.spec()['jobId'], {1234}, {1234: 5678})
        with self.assertRaises(ValueError):
            self.runtime.native_run_root([record, {**record, 'id': 'b' * 32}], self.spec()['jobId'], {1234}, {1234: 5678})

    def test_wrong_owner_store_cannot_be_used_as_a_restart_target(self):
        base = ROOT / '.sites-runtime/runtime-unit-tests'
        base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as tmp:
            import sqlite3
            path = Path(tmp) / 'device-auth.sqlite'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE account(id INTEGER PRIMARY KEY, owner TEXT)')
                db.execute('INSERT INTO account VALUES(1,?)', ('native-22222222-2222-4222-8222-222222222222',))
            with self.assertRaisesRegex(ValueError, 'OWNER'):
                self.runtime.verify_owner(Path(tmp), self.spec()['owner'])

    def test_partial_start_keeps_the_first_owned_pid_if_connector_start_fails(self):
        base = ROOT / '.sites-runtime/runtime-unit-tests'
        base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as tmp:
            spec = {**self.spec(), 'mode': 'production', 'state': tmp,
                    'tunnelId': '22222222-2222-4222-8222-222222222222'}
            config = Path(tmp) / 'spec.json'
            config.write_text(json.dumps(spec))
            identity = {'pid': 1234, 'group': 1234, 'start': 'synthetic-start'}
            with patch.object(self.runtime, 'CONFIG', config), patch.object(self.runtime, 'process_alive', return_value=False), patch.object(self.runtime, 'ports_free', return_value=True), patch.object(self.runtime, 'verify_release'), patch.object(self.runtime, 'admit'), patch.object(self.runtime, 'production_token', return_value='SYNTHETIC-TUNNEL-TOKEN-0123456789012345', create=True), patch.object(self.runtime, 'launch', side_effect=[identity, ValueError('SYNTHETIC_CONNECTOR_START_FAILURE')]):
                with self.assertRaises(ValueError):
                    self.runtime.tick(spec)
            record = Path(tmp) / 'runtime-control.json'
            self.assertTrue(record.exists(), 'The first owned process must not become an untracked orphan')
            self.assertEqual(json.loads(record.read_text())['roles']['app'], identity)


if __name__ == '__main__':
    unittest.main()

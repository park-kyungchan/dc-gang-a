"""Pure launcher controls; synthetic keys only, no native credential access."""
import importlib.util
import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('native_elevenlabs', ROOT / 'scripts/native-elevenlabs.py')
MODULE = importlib.util.module_from_spec(SPEC)


class LauncherContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SPEC.loader.exec_module(MODULE)

    def test_only_the_selected_credential_reaches_the_worker(self):
        env = MODULE.worker_environment('fixture-elevenlabs-not-a-real-key', {
            'PATH': '/bin', 'LANG': 'C.UTF-8', 'HOME': '/not-the-app',
            'OPENAI_API_KEY': 'fixture-do-not-forward',
            'HERMES_DASHBOARD_TOKEN': 'fixture-do-not-forward',
            'CLOUDFLARE_API_TOKEN': 'fixture-do-not-forward',
            'PYTHONPATH': '/not-for-the-worker',
        })
        self.assertEqual(env['ELEVENLABS_API_KEY'], 'fixture-elevenlabs-not-a-real-key')
        for forbidden in ('OPENAI_API_KEY', 'HERMES_DASHBOARD_TOKEN', 'CLOUDFLARE_API_TOKEN', 'PYTHONPATH'):
            self.assertNotIn(forbidden, env)
        self.assertEqual(env['CLOUDFLARE_INCLUDE_PROCESS_ENV'], 'true')

    def test_key_format_is_rejected_not_normalized(self):
        for key in (None, '', 'short', 'fixture-key-with-space here', 'fixture-key-with-newline\n', 'x' * 1025):
            with self.subTest(kind=type(key).__name__):
                with self.assertRaises(MODULE.ConnectionSetupError):
                    MODULE.worker_environment(key, {'PATH': '/bin'})

    def test_live_command_is_fixed_local_and_has_no_credential_argument(self):
        cmd = MODULE.worker_command()
        self.assertIn('--local', cmd)
        self.assertIn('127.0.0.1', cmd)
        self.assertIn('4175', cmd)
        self.assertIn('tests/native-live/wrangler.json', cmd)
        self.assertIn('.sites-runtime/native-live/state', cmd)
        self.assertNotIn('--remote', cmd)
        self.assertNotIn('--tunnel', cmd)
        self.assertNotIn('fixture-elevenlabs-not-a-real-key', ' '.join(cmd))

    def test_public_status_never_contains_key_material(self):
        status = MODULE.public_status(True)
        self.assertEqual(status['credential_state'], 'present_unverified')
        self.assertNotIn('key', status)
        self.assertNotIn('value', status)
        self.assertNotIn('fingerprint', status)


class SheetBridgeLauncherContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('spt_native_runner', ROOT / 'scripts/spt_native_runner.py')
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_native_owner_and_key_are_separate_public_and_secret_bindings(self):
        key = 'SYNTHETIC-HMAC-KEY-NOT-A-CREDENTIAL-0123456789'
        owner = 'native-11111111-1111-4111-8111-111111111111'
        values, secrets = self.module.sheet_bridge_bindings('https://script.google.com/macros/s/SYNTHETIC/exec', owner, key)
        self.assertEqual(values['SPT_SHEET_BRIDGE_OWNER_KEY'], owner)
        self.assertEqual(secrets, {'SPT_SHEET_BRIDGE_KEY': key})
        self.assertNotIn(key, json.dumps(values))

    def test_malformed_binding_is_refused_without_normalization(self):
        url = 'https://script.google.com/macros/s/SYNTHETIC/exec'
        owner = 'native-11111111-1111-4111-8111-111111111111'
        key = 'SYNTHETIC-HMAC-KEY-NOT-A-CREDENTIAL-0123456789'
        for bad in [None, '', 'short', key+'\n']:
            with self.subTest(key_type=type(bad).__name__), self.assertRaises(ValueError):
                self.module.sheet_bridge_bindings(url, owner, bad)
        for bad in ['', 'native-'+ 'a'*64, owner+' ']:
            with self.subTest(owner=bad), self.assertRaises(ValueError):
                self.module.sheet_bridge_bindings(url, bad, key)
        for bad in ['http://script.google.com/macros/s/SYNTHETIC/exec', 'https://example.invalid/exec', url+'?key=NO']:
            with self.subTest(url=bad), self.assertRaises(ValueError):
                self.module.sheet_bridge_bindings(bad, owner, key)

    def test_continuous_runtime_has_no_deadline_but_bounded_runs_keep_their_limit(self):
        now = datetime(2026, 9, 14, 0, 0, tzinfo=timezone.utc)
        self.assertEqual(self.module.runtime_deadline(None, now), '')
        self.assertEqual(self.module.runtime_deadline(30, now), '2026-09-14T00:30:00+00:00')
        for bad in (0, 721, -1):
            with self.assertRaises(ValueError):
                self.module.runtime_deadline(bad, now)

    def test_audio_bridge_requires_owner_and_explicit_operation_while_legacy_is_original_only(self):
        import http.client
        import threading
        from http.server import ThreadingHTTPServer
        calls=[]
        class Importer:
            def capabilities(self):return {'protocol':'spt.audio-import.v2','ready':True,'transcribeAllowed':False,'reason':'disabled'}
            def process(self,*args,operation='finalize'):calls.append((args,operation));return {'status':'stored','operation':operation}
        owner='SYNTHETIC-OWNER';token='SYNTHETIC-NATIVE-TOKEN'
        server=ThreadingHTTPServer(('127.0.0.1',0),self.module.native_handler(None,owner,token,Importer(),False));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(payload,who=owner):
            client=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
            try:
                client.request('POST','/audio-import',json.dumps(payload),{'Content-Type':'application/json','X-SPT-Owner':who,'Authorization':'Bearer '+token});response=client.getresponse();return response.status,json.loads(response.read())
            finally:client.close()
        try:
            self.assertEqual(request({'action':'capabilities'})[1]['transcribeAllowed'],False)
            self.assertEqual(request({'action':'capabilities'},'foreign')[0],403)
            payload={'importId':'synthetic-import','attemptId':'synthetic-attempt','recover':False}
            self.assertEqual(request(payload)[1]['operation'],'finalize')
            self.assertEqual(request({**payload,'operation':'transcribe'})[1]['operation'],'transcribe')
            self.assertEqual(request({**payload,'recover':'false'})[0],502)
            self.assertEqual(request({**payload,'operation':'unexpected'})[0],502)
            self.assertEqual([x[1] for x in calls],['finalize','transcribe'])
        finally:server.shutdown();server.server_close();thread.join(timeout=3)

    def test_readiness_requires_actual_worker_owner_and_build_not_just_an_open_port(self):
        owner = 'native-11111111-1111-4111-8111-111111111111'
        key = 'SYNTHETIC-INTERNAL-SESSION-KEY-0123456789'
        for who, build, status, expected in [(owner, 'spt-fixture', 200, True), ('foreign', 'spt-fixture', 200, False), (owner, 'wrong', 200, False), (owner, 'spt-fixture', 503, False)]:
            with self.subTest(owner=who, build=build, status=status), patch.object(self.module.http.client, 'HTTPConnection') as connection:
                response = connection.return_value.getresponse.return_value
                response.status = status
                response.read.return_value = json.dumps({'ownerKey': who, 'runtime': {'buildId': build}}).encode()
                self.assertEqual(self.module.worker_ready(4179, owner, key, 'spt-fixture'), expected)
                connection.return_value.request.assert_called_once_with('GET', '/api/identity', headers={'X-SPT-Backend-Token': key})
                connection.return_value.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()

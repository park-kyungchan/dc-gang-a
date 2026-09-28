"""Rehearsal route contracts: no real credentials/providers/listeners."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('rehearsal_runner', ROOT/'scripts/spt_native_runner.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
RUN = '11111111-2222-4333-8444-555555555555'
OWNER = 'native-11111111-1111-4111-8111-111111111111'

class RehearsalLauncherTests(unittest.TestCase):
    def options(self, **changes):
        values = dict(run_id=RUN, state=m.ROOT/'.sites-runtime/backend-private'/('rehearsal-'+RUN), origin='https://qa-spt.kcpalantir.tech', owner=OWNER, analyses=3, transcriptions=3, class_date='2026-09-14', student_ids=['S001','S002','S004'], private_test=False)
        values.update(changes)
        return m.rehearsal_options(**values)

    def test_explicit_rehearsal_is_isolated_and_bounded(self):
        value = self.options()
        self.assertEqual(value['ports'], (4179,4182,4183))
        self.assertEqual(value['max_file_seconds'], 120)
        self.assertEqual(value['owner'], OWNER)

    def test_production_store_origin_or_unbounded_calls_are_refused(self):
        for change in [dict(state=m.ROOT/'.sites-runtime/backend-private/classroom'),dict(origin='https://spt.kcpalantir.tech'),dict(run_id='../escape'),dict(owner='native-bad'),dict(analyses=4),dict(transcriptions=4),dict(class_date='2026-02-30'),dict(student_ids=['S001','S001']),dict(private_test=True)]:
            with self.subTest(change=change), self.assertRaises(ValueError):self.options(**change)

    def test_workbench_synthetic_scope_is_loopback_provider_free_and_bound_to_its_state(self):
        state=m.ROOT/'.sites-runtime/backend-private'/('workbench-'+RUN)
        value=m.workbench_options(run_id=RUN,state=state,origin='http://127.0.0.1:4183',
                                  class_date='2026-09-23',student_ids=['S003'],private_test=True)
        self.assertEqual(value,{'run_id':RUN,'ports':(4179,4182,4183),'date':'2026-09-23','student_ids':['S003']})
        for change in [dict(state=m.ROOT/'.sites-runtime/backend-private/classroom'),
                       dict(origin='https://qa-spt.kcpalantir.tech'),dict(run_id='../escape'),
                       dict(class_date='2040-02-30'),dict(student_ids=[]),dict(student_ids=['S003','S003']),
                       dict(private_test=False)]:
            values=dict(run_id=RUN,state=state,origin='http://127.0.0.1:4183',class_date='2026-09-23',student_ids=['S003'],private_test=True)
            values.update(change)
            with self.subTest(change=change),self.assertRaises(ValueError):m.workbench_options(**values)

    def test_existing_actor_can_initialize_only_a_new_isolated_account(self):
        with tempfile.TemporaryDirectory() as d:
            state=Path(d)/'new'; store=m.backend.AuthStore(state, owner=OWNER)
            self.assertEqual(store.owner, OWNER)
            token,code=store.request();store.approve(code,24)
            with self.assertRaises(ValueError):m.backend.AuthStore(state,owner='native-22222222-2222-4222-8222-222222222222')
            self.assertEqual(store.status(token)['state'],'approved')

    def test_native_attempt_allowance_survives_rehearsal_restart(self):
        with tempfile.TemporaryDirectory() as d:
            state=Path(d);(state/'analysis'/RUN).mkdir(parents=True)
            runner=m.NativeAnalysis(state,3,resume_usage=True)
            self.assertEqual(runner.started,1)
            self.assertEqual(m.NativeAnalysis(state,3).started,0)

class RehearsalRetirementTests(unittest.TestCase):
    def test_retirement_rejects_live_or_foreign_state_and_keeps_archive(self):
        import json
        with tempfile.TemporaryDirectory() as d, patch.object(m,'ROOT',Path(d)):
            state=Path(d)/'.sites-runtime/backend-private'/('rehearsal-'+RUN)
            store=m.backend.AuthStore(state,owner=OWNER);token,code=store.request();store.approve(code,24)
            (state/'rehearsal.json').write_text(json.dumps({'run_id':RUN,'owner':OWNER}))
            (state/'test-data.txt').write_text('SYNTHETIC evidence to preserve')
            with self.assertRaises(ValueError):m.retire_rehearsal(state,RUN,ports_available=lambda:False)
            with self.assertRaises(ValueError):m.retire_rehearsal(state.parent/'classroom',RUN,ports_available=lambda:True)
            result=m.retire_rehearsal(state,RUN,ports_available=lambda:True)
            archive=Path(result['archive']);self.assertEqual((archive/'test-data.txt').read_text(),'SYNTHETIC evidence to preserve')
            self.assertEqual(m.backend.AuthStore(archive).status(token)['state'],'expired')
            self.assertFalse((state/'device-auth.sqlite').exists());self.assertTrue((state/'retired-rehearsal.json').is_file())
            with self.assertRaises(ValueError):m.retire_rehearsal(state,RUN,ports_available=lambda:True)

class RehearsalDurationTests(unittest.TestCase):
    def test_overlong_valid_audio_is_retained_before_any_key_or_provider_call(self):
        import io,json,wave
        output=io.BytesIO()
        with wave.open(output,'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(b'\0\0'*16000)
        raw=output.getvalue()
        class Fixture(m.audio_import.AudioImporter):
            def get(self,path):
                if '&original=1' in path:return io.BytesIO(raw)
                return io.BytesIO(json.dumps({'id':RUN,'attempt_id':RUN,'status':'processing','filename':'SYNTHETIC.wav','mime':'audio/wav','size':len(raw)}).encode())
        def forbidden():raise AssertionError('DURATION_MUST_PRECEDE_CREDENTIAL_ACCESS')
        with tempfile.TemporaryDirectory() as d:
            importer=Fixture(Path(d),OWNER,'SYNTHETIC',forbidden,limit=3,max_seconds=.5)
            result=importer.process(RUN,RUN)
            self.assertEqual(result['status'],'stored');self.assertFalse(result['providerCallPerformed']);self.assertEqual(importer.calls,0)
            self.assertEqual((importer.root/RUN/RUN/'original.audio').read_bytes(),raw)

    def test_import_duration_bound_and_persisted_usage(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            state=Path(d);attempt=state/'file-imports'/RUN/RUN;attempt.mkdir(parents=True)
            (attempt/'request.json').write_text(json.dumps({'provider_call_started':True}))
            importer=m.audio_import.AudioImporter(state,OWNER,'SYNTHETIC',lambda:None,limit=3,max_seconds=120,resume_usage=True)
            self.assertEqual(importer.max_seconds,120);self.assertEqual(importer.calls,1)
            with self.assertRaises(ValueError):m.audio_import.AudioImporter(state,OWNER,'SYNTHETIC',lambda:None,max_seconds=0)

if __name__ == '__main__':unittest.main()

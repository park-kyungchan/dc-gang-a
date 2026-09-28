"""Real media probe + fake provider boundary. No native keys/network/model use."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import uuid
import wave
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('spt_audio_import_test',ROOT/'scripts/spt_audio_import.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class FileImportTests(unittest.TestCase):
 def setUp(self):
  parent=ROOT/'.sites-runtime/audio-import-tests';parent.mkdir(parents=True,exist_ok=True)
  self.tmp=tempfile.TemporaryDirectory(dir=parent);self.path=Path(self.tmp.name)
  b=io.BytesIO()
  with wave.open(b,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(b'\x00\x01'*16000)
  self.raw=b.getvalue();self.import_id=str(uuid.uuid4());self.attempt_id=str(uuid.uuid4());self.calls=0
 def tearDown(self):self.tmp.cleanup()
 def consumer(self,key=None,limit=1,broken=False):
  outer=self
  def provider(*_args):
   outer.calls+=1
   if broken:raise TimeoutError('SYNTHETIC_PROVIDER_TIMEOUT')
   return {'text':'SYNTHETIC TRANSCRIPT ONLY','words':[]}
  class FixtureConsumer(m.AudioImporter):
   def get(self,path):
    if '&original=1' in path:return io.BytesIO(outer.raw)
    return io.BytesIO(json.dumps({'id':outer.import_id,'attempt_id':outer.attempt_id,'status':'processing','filename':'SYNTHETIC.wav','mime':'audio/wav','size':len(outer.raw),'transcription':{'state':'not_found','entryIds':[]}}).encode())
  return FixtureConsumer(self.path,'SYNTHETIC_OWNER','SYNTHETIC_INTERNAL_TOKEN',lambda:key,limit=limit,provider=provider)
 def test_missing_key_preserves_real_probe_result_without_provider(self):
  c=self.consumer();r=c.process(self.import_id,self.attempt_id,operation='transcribe')
  self.assertEqual(r['status'],'stored',r);self.assertAlmostEqual(r['duration'],1);self.assertFalse(r['providerCallPerformed']);self.assertEqual(self.calls,0)
  self.assertEqual((c.root/self.import_id/self.attempt_id/'original.audio').read_bytes(),self.raw)
 def test_result_recovery_does_not_repeat_provider_or_copy_key(self):
  secret='SYNTHETIC_PROVIDER_KEY_NOT_REAL';c=self.consumer(secret);r=c.process(self.import_id,self.attempt_id,operation='transcribe')
  self.assertEqual(r['status'],'transcribed',r);self.assertEqual(self.calls,1)
  self.assertEqual(c.process(self.import_id,self.attempt_id,True),r);self.assertEqual(self.calls,1)
  with self.assertRaisesRegex(ValueError,'ALREADY_CONSUMED'):c.process(self.import_id,self.attempt_id)
  for p in c.root.rglob('*.json'):self.assertNotIn(secret,p.read_text())
 def test_malformed_audio_never_reaches_provider(self):
  self.raw=b'SYNTHETIC_NOT_AUDIO';c=self.consumer('SYNTHETIC_KEY_NOT_REAL');r=c.process(self.import_id,self.attempt_id,operation='transcribe')
  self.assertEqual(r['status'],'invalid',r);self.assertEqual(self.calls,0)
 def test_timeout_is_terminal_and_readback_never_reissues(self):
  c=self.consumer('SYNTHETIC_KEY_NOT_REAL',broken=True);r=c.process(self.import_id,self.attempt_id,operation='transcribe')
  self.assertEqual(r['status'],'unknown');self.assertEqual(self.calls,1);self.assertTrue(r['providerCallPerformed'])
  c.process(self.import_id,self.attempt_id,True);self.assertEqual(self.calls,1)
 def test_no_provider_allowance_is_not_overridden_by_key_presence(self):
  c=self.consumer('SYNTHETIC_KEY_NOT_REAL',limit=0);r=c.process(self.import_id,self.attempt_id,operation='transcribe')
  self.assertEqual(r['status'],'stored',r);self.assertEqual(self.calls,0)
 def test_stop_and_malformed_ids_cannot_spawn_decoder(self):
  c=self.consumer();c.stop()
  with patch.object(m.subprocess,'Popen',side_effect=AssertionError('FORBIDDEN_DISPATCH')) as dispatch:
   with self.assertRaisesRegex(ValueError,'STOPPED'):c.process(self.import_id,self.attempt_id)
   with self.assertRaisesRegex(ValueError,'INVALID_IMPORT_ID'):c.process('../other',self.attempt_id)
   dispatch.assert_not_called()

 def test_default_original_finalization_never_reads_key_or_calls_provider(self):
  c=self.consumer('SYNTHETIC_PROVIDER_KEY_NOT_REAL',limit=1)
  with patch.object(c,'key_getter',return_value='SYNTHETIC_PROVIDER_KEY_NOT_REAL') as getter:
   r=c.process(self.import_id,self.attempt_id)
   self.assertEqual(r['status'],'stored',r)
   getter.assert_not_called()
  self.assertFalse(r['providerCallPerformed']);self.assertEqual(self.calls,0)
  self.assertEqual((c.root/self.import_id/self.attempt_id/'original.audio').read_bytes(),self.raw)

 def test_transcript_arriving_during_media_probe_is_rechecked_before_provider(self):
  c=self.consumer('SYNTHETIC_PROVIDER_KEY_NOT_REAL');original=c.get;reads=0
  def read(path):
   nonlocal reads
   data=original(path)
   if '&original=1' in path:return data
   reads+=1;metadata=json.loads(data.read())
   if reads>1:metadata['transcription']={'state':'available','entryIds':['synthetic-retained-entry']}
   return io.BytesIO(json.dumps(metadata).encode())
  with patch.object(c,'get',side_effect=read),patch.object(c,'key_getter',return_value='SYNTHETIC_PROVIDER_KEY_NOT_REAL') as getter:
   r=c.process(self.import_id,self.attempt_id,operation='transcribe')
   self.assertEqual(r['status'],'stored',r);getter.assert_not_called()
  self.assertEqual(self.calls,0);self.assertFalse(r['providerCallPerformed'])

 def test_capability_read_is_non_secret_and_cannot_consume_or_restore_allowance(self):
  c=self.consumer('SYNTHETIC_PROVIDER_KEY_NOT_REAL',limit=0)
  with patch.object(c,'key_getter',side_effect=AssertionError('FORBIDDEN_KEY_READ')):
   self.assertEqual(c.capabilities(),{'protocol':'spt.audio-import.v2','ready':True,'transcribeAllowed':False,'reason':'disabled'})
   c.stop();self.assertFalse(c.capabilities()['ready'])

if __name__=='__main__':unittest.main()

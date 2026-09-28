"""Actual paired-gateway/AuthStore contracts with a labeled in-memory Worker transport."""
import hashlib,importlib.util,io,json,tempfile,unittest,uuid
from email.message import Message
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('transfer_gateway',ROOT/'scripts/spt-backend.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TransferTests(unittest.TestCase):
 def setUp(self):
  base=ROOT/'.sites-runtime/transfer-tests';base.mkdir(parents=True,exist_ok=True);self.tmp=tempfile.TemporaryDirectory(dir=base);self.store=m.AuthStore(Path(self.tmp.name));self.parent,self.code=self.store.request(now=1000);self.store.approve(self.code,now=1001);self.now=1002
  self.id=str(uuid.uuid4());self.row={'id':self.id,'session_id':str(uuid.uuid4()),'student_id':'QA_TRANSFER_A','class_date':'2040-01-02','session_purpose':'test','session_title':'SYNTHETIC TRANSFER','status':'prepared','filename':None,'size':None,'mime':None,'duration':None,'attempt_id':None,'transcription':{'state':'not_found','entryIds':[]},'parts':[]};self.parts={};self.calls=[];self.fail_part=None
 def tearDown(self):self.tmp.cleanup()
 def worker(self,method,path,body,headers):
  self.calls.append((method,path));self.assertEqual(headers['X-SPT-Backend-Token'],'SYNTHETIC_INTERNAL');self.assertNotIn(self.parent,str(headers));self.assertNotIn('X-SPT-Transfer',headers)
  if path=='/api/audio-import?id='+self.id and method=='GET':return 200,self.row
  if path.startswith('/api/audio-import?') and method=='POST':
   seq=int(path.split('part=')[1]);self.parts[seq]=bytes(body);self.row['parts']=[{'seq':n,'size':len(b),'hash':hashlib.sha256(b).hexdigest()} for n,b in sorted(self.parts.items())]
   if seq==self.fail_part:self.fail_part=None;raise ConnectionResetError('SYNTHETIC_LOST_ACK_AFTER_WRITE')
   return 200,{'saved':True}
  if path=='/api/audio-import' and method=='POST':
   p=json.loads(body);self.assertEqual(p['id'],self.id)
   if p['action']=='file':self.row.update(filename=p['filename'],size=p['size'],mime=p['mime'],status='uploading')
   elif p['action'] in ('finalize','recover'):self.row.update(status='stored',duration=2,attempt_id=self.row['attempt_id'] or str(uuid.uuid4()))
   else:raise AssertionError('FORBIDDEN_NON_ORIGINAL_OPERATION')
   return 200,self.row
  return 404,{'error':'SYNTHETIC_ROUTE_NOT_FOUND'}
 def request(self,path,method='POST',payload=None,raw=None,grant=None,cookie=True,origin=True,headers=None,authorization=None):
  outer=self
  class Connection:
   def __init__(self,*_,**__):pass
   def request(self,method,path,body=None,headers=None):self.answer=outer.worker(method,path,body,headers)
   def getresponse(self):
    status,data=self.answer
    class Response(io.BytesIO):
     def getheaders(self):return [('Content-Type','application/json')]
    response=Response(json.dumps(data).encode());response.status=status;return response
   def close(self):pass
  h=object.__new__(m.handler_for(self.store,'https://spt.example',4173,'SYNTHETIC_INTERNAL'));h.headers=Message();h.headers['Host']='spt.example'
  if cookie:h.headers['Cookie']=m.COOKIE+'='+self.parent
  if origin:h.headers['Origin']='https://spt.example' if origin is True else origin
  if authorization:h.headers['Authorization']='Bearer '+authorization
  if grant:h.headers['X-SPT-Transfer']=grant
  data=raw if raw is not None else json.dumps(payload or {}).encode() if method=='POST' else b'';h.headers['Content-Length']=str(len(data));h.headers['Content-Type']='application/octet-stream' if raw is not None else 'application/json'
  for key,value in (headers or {}).items():h.headers[key]=value
  h.command=method;h.path=path;h.rfile=io.BytesIO(data);h.wfile=io.BytesIO();status=[];h.send_response=status.append;h.send_header=lambda *_:None;h.end_headers=lambda:None
  with patch.object(m.time,'time',return_value=self.now),patch.object(m.http.client,'HTTPConnection',Connection):h.handle_request()
  self.assertEqual(len(status),1);return status[0],json.loads(h.wfile.getvalue()) if h.wfile.getvalue() else {}
 def issue(self):
  status,value=self.request('/api/audio-transfer/grant',payload={'id':self.id});self.assertEqual(status,201);self.assertEqual(value['protocol'],'spt.audio-transfer.v1');self.assertEqual(value['importId'],self.id);return value
 def upload(self,grant,data,name='SYNTHETIC.wav',**kwargs):return self.request('/api/audio-transfer/upload',cookie=False,origin=False,grant=grant,raw=data,headers={'X-SPT-Filename':name},**kwargs)
 def test_approved_browser_issues_only_the_existing_import_not_an_app_login(self):
  value=self.issue();token=value['token'];self.assertNotEqual(token,self.parent);self.assertEqual(self.store.status(token,now=self.now)['state'],'missing');self.assertEqual(value['studentId'],self.row['student_id']);self.assertEqual(value['classDate'],self.row['class_date']);self.assertLessEqual(value['expiresAt'],self.now+21600)
  status,_=self.request('/api/notebook',method='GET',cookie=False,origin=False,grant=token);self.assertEqual(status,401)
  with self.store.connect() as db:self.assertNotIn(token,str(db.execute('SELECT * FROM audio_transfer_grants').fetchall()))
 def test_shortcut_binary_body_is_chunked_into_existing_original_only_operations(self):
  g=self.issue();data=b'SYNTHETIC-BINARY-NOT-DECODED-'*80000;status,value=self.upload(g['token'],data);self.assertEqual(status,200);self.assertTrue(value['stored']);self.assertTrue(value['inputConfirmed']);self.assertEqual(value['sha256'],hashlib.sha256(data).hexdigest());self.assertEqual(b''.join(self.parts[n] for n in sorted(self.parts)),data);self.assertEqual(value['sessionId'],self.row['session_id']);self.assertTrue(all(len(x)<=1048576 for x in self.parts.values()))
  before=len([x for x in self.calls if x==('POST','/api/audio-import')]);status,again=self.upload(g['token'],data);self.assertEqual(status,200);self.assertEqual(again['sha256'],value['sha256']);self.assertEqual(before,len([x for x in self.calls if x==('POST','/api/audio-import')]))
 def test_lost_part_acknowledgement_reuses_the_claim_and_matching_bytes(self):
  g=self.issue();data=b'SYNTHETIC'*180000;self.fail_part=0;status,_=self.upload(g['token'],data);self.assertEqual(status,502);self.assertEqual(self.row['status'],'uploading');self.assertEqual(len(self.parts),1)
  status,value=self.upload(g['token'],data);self.assertEqual(status,200);self.assertTrue(value['stored']);self.assertEqual(value['importId'],self.id)
 def test_same_length_replacement_is_rejected_even_after_grant_rotation(self):
  g=self.issue();self.assertEqual(self.upload(g['token'],b'SYNTHETIC1')[0],200);before=dict(self.parts);next_grant=self.issue();self.assertEqual(self.upload(g['token'],b'SYNTHETIC1')[0],403);self.assertEqual(self.upload(next_grant['token'],b'SYNTHETIC2')[0],409);self.assertEqual(self.parts,before)
 def test_revocation_expiry_and_foreign_origin_cannot_dispatch(self):
  g=self.issue();before=len(self.calls);status,_=self.request('/api/audio-transfer/upload',cookie=False,origin=False,grant=g['token'],raw=b'x',headers={'Origin':'https://foreign.example','X-SPT-Filename':'SYNTHETIC.wav'});self.assertEqual(status,403);self.assertEqual(len(self.calls),before)
  self.store.revoke(self.code);self.assertEqual(self.upload(g['token'],b'SYNTHETIC')[0],403);self.assertEqual(len(self.calls),before)
 def test_expired_scoped_authority_does_not_become_sliding(self):
  g=self.issue();self.now=g['expiresAt']+1;before=len(self.calls);self.assertEqual(self.upload(g['token'],b'x')[0],403);self.assertEqual(len(self.calls),before)
 def test_normal_limits_and_cookie_origin_guards_are_not_relaxed(self):
  self.assertEqual(self.request('/api/audio-transfer/grant',payload={'id':self.id},origin=False)[0],403);self.assertEqual(self.request('/api/audio-transfer/grant',payload={'id':self.id},cookie=False)[0],401)
  self.assertEqual(self.request('/api/notebook',raw=b'x'*(m.MAX_BODY+1))[0],413)
  g=self.issue();self.assertEqual(self.request('/api/audio-transfer/upload?other=x',cookie=False,origin=False,grant=g['token'],raw=b'x')[0],400)
 def test_conflicting_preexisting_part_cannot_poison_the_later_correct_file(self):
  good=b'SYNTHETIC1';self.parts[0]=good;self.row.update(filename='SYNTHETIC.wav',size=len(good),status='uploading',parts=[{'seq':0,'size':len(good),'hash':hashlib.sha256(good).hexdigest()}]);g=self.issue()
  self.assertEqual(self.upload(g['token'],b'SYNTHETIC2')[0],409);self.assertEqual(self.upload(g['token'],good)[0],200)
 def test_a_worker_ack_without_parts_is_not_a_confirmed_input_or_finalize_permission(self):
  g=self.issue();original=self.worker
  def missing(method,path,body,headers):
   if 'part=' in path:return 200,{'saved':True}
   return original(method,path,body,headers)
  with patch.object(self,'worker',side_effect=missing):self.assertEqual(self.upload(g['token'],b'SYNTHETIC')[0],409)
  self.assertEqual(self.row['status'],'uploading')
  with patch.object(m.time,'time',return_value=self.now):self.assertFalse(self.store.transfer(g['token'])['input_confirmed'])
 def test_an_unknown_prior_attempt_is_not_recovered_with_delegated_upload_rights(self):
  g=self.issue();self.assertEqual(self.upload(g['token'],b'SYNTHETIC')[0],200);self.row['status']='unknown';before=list(self.calls);status,value=self.upload(g['token'],b'SYNTHETIC');self.assertEqual(status,200);self.assertFalse(value['stored']);self.assertEqual(value['status'],'unknown');self.assertTrue(all(method=='GET' for method,_ in self.calls[len(before):]))
 def test_body_deadline_is_absolute_not_an_unlimited_sequence_of_socket_waits(self):
  g=self.issue()
  with patch.object(m.time,'monotonic',side_effect=[0,181]):self.assertEqual(self.upload(g['token'],b'SYNTHETIC')[0],408)
  self.assertFalse(self.parts);self.assertEqual(self.row['status'],'prepared')
 def test_native_original_transfer_requires_matching_live_session_and_preserves_browser_flow(self):
  secret,code=self.store.request(now=self.now,client_kind='native');self.store.approve(code,now=self.now+1,personal=True);self.now+=2
  session,_=self.store.issue_native_session(secret,now=self.now)
  native=dict(cookie=False,origin=m.NATIVE_ORIGIN,authorization=session)
  status,grant=self.request('/api/audio-transfer/grant',payload={'id':self.id},**native)
  self.assertEqual(status,201);self.assertEqual(grant['importId'],self.id)
  data=b'SYNTHETIC-NATIVE-ORIGINAL'*20
  status,receipt=self.request('/api/audio-transfer/upload',raw=data,grant=grant['token'],headers={'X-SPT-Filename':'SYNTHETIC.wav'},**native)
  self.assertEqual(status,200);self.assertTrue(receipt['stored']);self.assertEqual(receipt['sha256'],hashlib.sha256(data).hexdigest())
  self.assertEqual(self.request('/api/audio-transfer/status',method='GET',grant=grant['token'],**native)[0],200)
  other_secret,other_code=self.store.request(now=self.now,client_kind='native');self.store.approve(other_code,now=self.now+1,personal=True)
  other_session,_=self.store.issue_native_session(other_secret,now=self.now+2);self.now+=2
  self.assertEqual(self.request('/api/audio-transfer/status',method='GET',grant=grant['token'],cookie=False,origin=m.NATIVE_ORIGIN,authorization=other_session)[0],401)
  self.assertEqual(self.request('/api/audio-transfer/status',method='GET',grant=grant['token'],cookie=False,origin=m.NATIVE_ORIGIN)[0],401)
  self.assertEqual(self.request('/api/audio-transfer/status',method='GET',grant=grant['token'],cookie=False,origin=False)[0],403)
  self.assertEqual(self.request('/api/audio-transfer/revoke',payload={'id':self.id},**native)[0],200)
  self.assertEqual(self.request('/api/audio-transfer/status',method='GET',grant=grant['token'],**native)[0],403)
 def test_native_audio_preflight_and_expiry_fail_closed(self):
  secret,code=self.store.request(now=self.now,client_kind='native');self.store.approve(code,now=self.now+1,personal=True);self.now+=2
  session,expires=self.store.issue_native_session(secret,now=self.now)
  status,_=self.request('/api/audio-transfer/upload',method='OPTIONS',cookie=False,origin=m.NATIVE_ORIGIN,headers={'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,x-spt-transfer,x-spt-filename'})
  self.assertEqual(status,204)
  self.assertEqual(self.request('/api/classroom',method='OPTIONS',cookie=False,origin=m.NATIVE_ORIGIN,headers={'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-spt-transfer'})[0],403)
  status,grant=self.request('/api/audio-transfer/grant',payload={'id':self.id},cookie=False,origin=m.NATIVE_ORIGIN,authorization=session)
  self.assertEqual(status,201);before=len(self.calls);self.now=expires
  self.assertEqual(self.request('/api/audio-transfer/upload',raw=b'SYNTHETIC',grant=grant['token'],cookie=False,origin=m.NATIVE_ORIGIN,authorization=session,headers={'X-SPT-Filename':'SYNTHETIC.wav'})[0],401)
  self.assertEqual(len(self.calls),before)
if __name__=='__main__':unittest.main()

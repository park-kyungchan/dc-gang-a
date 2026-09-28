"""Synthetic native academy contracts. No credentials/network/provider calls."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
import copy
import tempfile
import uuid
ROOT=Path(__file__).resolve().parents[1]

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class NativeRoute(unittest.TestCase):
    def test_existing_authenticated_connector_consumes_the_admitted_academy_action(self):
        runner=load('academy_test_runner',ROOT/'scripts/spt_native_runner.py')
        calls=[]
        class Academy:
            def handle(self,payload):
                calls.append(payload)
                return {'state':'prepared','scope':'synthetic'}
        handler=runner.native_handler(None,'SYNTHETIC_OWNER','SYNTHETIC_INTERNAL_TOKEN',allow_analysis=False,academy=Academy())
        h=handler.__new__(handler)
        payload={'action':'preview','entryId':'ac12afed-a022-4040-8102-7692778379be'}
        raw=json.dumps(payload).encode()
        h.path='/academy';h.headers={'X-SPT-Owner':'SYNTHETIC_OWNER','Authorization':'Bearer SYNTHETIC_INTERNAL_TOKEN','Content-Length':str(len(raw))}
        h.rfile=io.BytesIO(raw);h.wfile=io.BytesIO();statuses=[]
        h.send_response=statuses.append;h.send_header=lambda *args:None;h.end_headers=lambda:None
        h.do_POST()
        self.assertEqual(statuses,[200]);self.assertEqual(calls,[payload]);self.assertEqual(json.loads(h.wfile.getvalue())['state'],'prepared')

class ReviewedAcademy(unittest.TestCase):
    def setUp(self):
        self.module=load('academy_fixture',ROOT/'scripts/spt_academy.py')
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT/'.sites-runtime/curriculum-delivery-20260914')
        self.addCleanup(self.tmp.cleanup)
        self.id=str(uuid.uuid4())
        self.entry={'entryId':self.id,'studentId':'QA_A','studentName':'SYNTHETIC A','date':'2040-01-02','kind':'closeout','confirmed':True,'test':False,'evidenceCurrent':True,'fields':{'progress':'SYNTHETIC reviewed range 4-2, 4-4','homework':'SYNTHETIC reviewed homework p.42~47','class_memo':''}}
        self.mapping={'QA_A':{'name':'SYNTHETIC A','course_seq':'QA_C','student_pri_no':'QA_A','cm_seq':'QA_E','tutor_pri_no':'QA_T'}}
        self.row={'source_ref':'dayrecord:QA_C:QA_A:QA_R:QA_E','display_name':'SYNTHETIC A','course_label':'SYNTHETIC COURSE','source_mapping':{**{k:v for k,v in self.mapping['QA_A'].items() if k!='name'},'record_seq':'QA_R','row_index':0},'fields':{'progress':'OLD PROGRESS','homework':'OLD HOMEWORK','class_memo':'Existing public memo','attendance':'Y','daily_test':'9'}}
        self.writes=[];self.opens=0;self.closes=0;self.lose=False
        case=self
        class Client:
            def __enter__(self):case.opens+=1;return self
            def __exit__(self,*args):case.closes+=1
            def read(self,day,tutor):
                case.assertEqual(day,'2040-01-02');case.assertEqual(tutor,'QA_T');return [copy.deepcopy(case.row)]
            def write_field(self,row,field,value):
                case.assertIn(field,('progress','homework','class_memo'));case.writes.append((field,value));case.row['fields'][field]=value
                if case.lose:case.lose=False;raise TimeoutError('synthetic lost acknowledgement')
        self.bridge=self.module.AcademyBridge(self.tmp.name,'QA_OWNER','SYNTHETIC_TOKEN',client_factory=Client,entry_loader=lambda _:copy.deepcopy(self.entry),mappings=self.mapping,today=lambda:'2040-01-02')
    def test_actual_adapter_updates_only_reviewed_fields_and_independently_requeries(self):
        p=self.bridge.preview(self.id);self.assertEqual(p['state'],'prepared');self.assertEqual(self.writes,[])
        answer=self.bridge.apply(self.id,p['requestId']);self.assertEqual(answer['state'],'verified')
        self.assertEqual([x[0] for x in self.writes],['progress','homework'])
        self.assertEqual(self.row['fields']['class_memo'],'Existing public memo');self.assertEqual(self.row['fields']['attendance'],'Y');self.assertEqual(self.row['fields']['daily_test'],'9')
        self.assertEqual(self.opens,self.closes);self.assertGreaterEqual(self.opens,2)
        self.bridge.apply(self.id,p['requestId']);self.assertEqual(len(self.writes),2)
    def test_changed_source_conflicts_before_any_write(self):
        p=self.bridge.preview(self.id);self.row['fields']['progress']='NEWER OTHER WRITER'
        result=self.bridge.apply(self.id,p['requestId']);self.assertEqual(result['state'],'conflict');self.assertEqual(self.writes,[])
    def test_unknown_result_is_preserved_and_not_automatically_retried(self):
        p=self.bridge.preview(self.id);self.lose=True
        result=self.bridge.apply(self.id,p['requestId']);self.assertEqual(result['state'],'unknown');self.assertEqual(len(self.writes),1)
        with self.assertRaisesRegex(ValueError,'REQUERY'):self.bridge.apply(self.id,p['requestId'])
        with self.assertRaisesRegex(ValueError,'REQUERY'):self.bridge.preview(self.id)
        result=self.bridge.status(self.id,p['requestId']);self.assertEqual(result['state'],'conflict');self.assertEqual(len(self.writes),1)
        self.assertTrue(any(x['kind']=='independent_requery' for x in result['observations']))
    def test_noop_does_not_resave_original_for_a_success_marker(self):
        self.row['fields'].update(self.entry['fields']);p=self.bridge.preview(self.id)
        self.assertEqual(p['state'],'already_equal');self.bridge.apply(self.id,p['requestId']);self.assertEqual(self.writes,[])
    def test_stale_confirmation_wrong_student_and_future_date_fail_closed(self):
        original=copy.deepcopy(self.entry)
        for patch in ({'confirmed':False},{'evidenceCurrent':False},{'test':True},{'studentId':'QA_B'},{'date':'2040-01-03'}):
            self.entry={**original,**patch}
            with self.assertRaises(ValueError):self.bridge.preview(self.id)
        self.entry=original;p=self.bridge.preview(self.id);self.entry['fields']['progress']='Changed reviewed revision'
        with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):self.bridge.apply(self.id,p['requestId'])
        self.assertEqual(self.writes,[])
    def test_public_200_limit_and_unselected_source_fields(self):
        for text in ('가'*201,'😀'*101):
            self.entry['fields']['progress']=text
            with self.assertRaisesRegex(ValueError,'200'):self.bridge.preview(self.id)
        self.assertEqual(self.writes,[])
    def test_request_identity_and_enrollment_cannot_be_reassigned(self):
        p=self.bridge.preview(self.id)
        with self.assertRaisesRegex(ValueError,'SUBJECT'):self.bridge.apply(str(uuid.uuid4()),p['requestId'])
        self.row['source_mapping']['cm_seq']='OTHER_ENROLLMENT'
        with self.assertRaisesRegex(ValueError,'MAPPING_CHANGED'):self.bridge.apply(self.id,p['requestId'])
        self.assertEqual(self.writes,[])

if __name__=='__main__':unittest.main()

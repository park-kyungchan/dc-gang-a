"""Reviewed academy diary input through the existing SPT native connector.

No attendance, assessment, report or sending operations. Credentials remain in
an existing protected source and cookies live only inside one fresh operation.
The academy provides no demonstrated conditional-write primitive: compare and
requery every field, preserve uncertain attempts, never blindly retry/rollback.
"""
from __future__ import annotations
from contextlib import contextmanager
from datetime import date, datetime, timezone
import hashlib
from html.parser import HTMLParser
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import threading
import uuid
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
ORIGIN='https://dc.gang-a.kr'
DAY_PATH='/servlet/controller.cct.tutor.DayRecordServlet'
MAPPING=ROOT/'integrations/academy/students.json'
LOGIN_SOURCE=Path('/opt/data/profiles/math-ontology/cache/academy_vps_direct_login.py')
PARSER_SOURCE=Path('/opt/data/profiles/math-ontology/workspace/academy_phone_v2/source.py')
SOURCE_HASHES={LOGIN_SOURCE:'4448361dbf73086b187b5c3c06076c29532cd5a9e576897509e415d23ef25bb7',PARSER_SOURCE:'b78da69a5772b99132c83859bcd772922b06e4a5d07ee447c31d2e33dc564125'}
IDENTIFIERS=('course_seq','student_pri_no','cm_seq','tutor_pri_no')
FIELDS={'progress':('udtPrg','prg_txt'),'homework':('udtHw','hw_txt'),'class_memo':('udtMemo','memo_txt')}
UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')


def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def public_text_valid(value):
    if not isinstance(value,str) or len(value)>200:return False
    units=value.encode('utf-16-le')
    weight=sum(0 if c<32 else 2 if c>128 else 1 for c in [units[i]+256*units[i+1] for i in range(0,len(units),2)])
    return weight<=400 and not any(ord(c)<32 and c not in '\n\r\t' for c in value)


def module(name,path):
    if path.is_symlink() or not path.is_file():raise ValueError('ACADEMY_SOURCE_UNSAFE')
    if path not in SOURCE_HASHES or hashlib.sha256(path.read_bytes()).hexdigest()!=SOURCE_HASHES[path]:raise ValueError('ACADEMY_SOURCE_CHANGED')
    spec=importlib.util.spec_from_file_location(name,path)
    value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class DateInputs(HTMLParser):
    def __init__(self):
        super().__init__();self.dates=[]
    def handle_starttag(self,tag,attributes):
        a=dict(attributes)
        if tag=='input' and (a.get('id')=='std_date' or a.get('name')=='std_date'):self.dates.append(a.get('value'))


class AcademyClient:
    """One freshly authenticated source unit; does not call legacy main()."""
    def __init__(self):
        self.session=None
    def __enter__(self):
        import requests
        login=module('spt_academy_login_source',LOGIN_SOURCE)
        self.parser=module('spt_academy_parser_source',PARSER_SOURCE)
        for path in (login.ID_PATH,login.PASSWORD_PATH):
            m=path.lstat()
            if path.is_symlink() or not stat.S_ISREG(m.st_mode) or stat.S_IMODE(m.st_mode)!=0o600 or m.st_uid!=os.geteuid():raise ValueError('ACADEMY_CREDENTIAL_SOURCE_UNSAFE')
        s=requests.Session();self.session=s
        s.headers.update({'User-Agent':'Mozilla/5.0','Accept-Language':'ko-KR,ko;q=0.9','Accept':'text/html,application/xhtml+xml'})
        try:
            first=s.get(login.LOGIN_PAGE,timeout=20,verify=True,allow_redirects=False)
            if first.status_code!=200 or not login.session_cookie(s):raise ValueError('ACADEMY_LOGIN_REQUIRED')
            payload={k:'' for k in ('autoLoginCheck','autoLoginKey','cf_pc','cf_user','p_groupno','p_prino')}
            payload.update({'p_process':'c_login','userid':login.encoded_login_value(login.ID_PATH.read_text().strip()),'userpwd':login.encoded_login_value(login.PASSWORD_PATH.read_text().strip())})
            try:
                response=s.post(login.LOGIN_POST,data=payload,headers={'Referer':login.LOGIN_PAGE,'Origin':ORIGIN},timeout=20,verify=True,allow_redirects=False)
            finally:payload.clear()
            login.same_origin_or_none(response)
            if response.status_code not in (200,302,303):raise ValueError('ACADEMY_LOGIN_REQUIRED')
            return self
        except Exception:
            self.__exit__(None,None,None)
            raise ValueError('ACADEMY_LOGIN_REQUIRED') from None
    def __exit__(self,*_args):
        if self.session:self.session.cookies.clear();self.session.close();self.session=None
    def read(self,day,tutor):
        if date.fromisoformat(day).isoformat()!=day:raise ValueError('ACADEMY_DATE_INVALID')
        payload={'p_process':'Main','std_ymd':day.replace('-',''),'std_date':day,'visit':'1','teacher_pri_no':tutor,'grp_seq':'0'}
        response=self.session.post(ORIGIN+DAY_PATH,data=payload,timeout=20,verify=True,allow_redirects=False)
        if response.status_code!=200 or response.is_redirect or len(response.content)>2_000_000:raise ValueError('ACADEMY_SOURCE_UNAVAILABLE')
        text=response.content.decode('utf-8');p=DateInputs();p.feed(text)
        if p.dates!=[day]:raise ValueError('ACADEMY_DATE_MISMATCH')
        return self.parser.parse_dayrecord_rows(response.content)
    def write_field(self,row,field,value):
        if field not in FIELDS or not public_text_valid(value):raise ValueError('ACADEMY_FIELD_REJECTED')
        cmd,key=FIELDS[field];m=row['mapping']
        payload={'reqCmd':cmd,key:value,'course_seq':m['course_seq'],'stu_pri_no':m['student_pri_no'],'record_seq':m['record_seq'],'cm_seq':m['cm_seq']}
        response=self.session.get(ORIGIN+DAY_PATH,params=payload,timeout=20,verify=True,allow_redirects=False)
        if response.status_code!=200 or response.is_redirect or len(response.content)>2_000_000:raise ValueError('ACADEMY_WRITE_RESULT_UNKNOWN')
        # Even HTTP 200 and a legacy callback body do not prove the effect.


class AcademyBridge:
    def __init__(self,state,owner,worker_token,worker_port=4173,*,client_factory=AcademyClient,entry_loader=None,mappings=None,today=None):
        self.state=Path(state)/'academy';self.state.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.owner,self.worker_token,self.worker_port=owner,worker_token,worker_port
        self.client_factory=client_factory;self.entry_loader=entry_loader or self.worker_entry
        self.mappings=mappings if mappings is not None else json.loads(MAPPING.read_text())['students']
        self.today=today or (lambda:datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat())
        self.lock=threading.Lock()
    def worker_entry(self,entry_id):
        connection=http.client.HTTPConnection('127.0.0.1',self.worker_port,timeout=10)
        try:
            connection.request('GET','/api/academy?sourceId='+entry_id,headers={'X-SPT-Backend-Token':self.worker_token})
            response=connection.getresponse()
            if response.status!=200:raise ValueError('REVIEWED_SOURCE_CHANGED')
            value=json.loads(response.read(100000))
            if value.get('ownerKey')!=self.owner:raise ValueError('REVIEWED_SOURCE_OWNER')
            return value['source']
        finally:connection.close()
    def entry(self,entry_id):
        if not isinstance(entry_id,str) or not UUID.fullmatch(entry_id):raise ValueError('REVIEWED_SOURCE_ID')
        e=self.entry_loader(entry_id)
        if e.get('entryId')!=entry_id or e.get('kind')!='closeout' or e.get('confirmed') is not True or e.get('test') or e.get('evidenceCurrent') is not True:raise ValueError('REVIEWED_SOURCE_REQUIRED')
        if not isinstance(e.get('date'),str) or date.fromisoformat(e['date']).isoformat()!=e['date'] or e['date']>self.today():raise ValueError('ACADEMY_DATE_INVALID')
        fields=e.get('fields',{})
        if set(fields)!=set(FIELDS) or any(not public_text_valid(v) for v in fields.values()) or not fields['progress'].strip() or not fields['homework'].strip():raise ValueError('ACADEMY_PUBLIC_200_REQUIRED')
        if e.get('studentId') not in self.mappings:raise ValueError('ACADEMY_STUDENT_MAPPING_REQUIRED')
        return e
    def target(self,rows,e):
        mapping=self.mappings[e['studentId']]
        matches=[r for r in rows if all(r['source_mapping'].get(k)==mapping[k] for k in IDENTIFIERS)]
        if len(matches)!=1:raise ValueError('ACADEMY_STUDENT_MAPPING_CHANGED')
        r=matches[0]
        if r['display_name']!=mapping['name'] or r['display_name']!=e['studentName']:raise ValueError('ACADEMY_STUDENT_NAME_CHANGED')
        m={k:r['source_mapping'][k] for k in IDENTIFIERS+('record_seq',)}
        return {'sourceRef':r['source_ref'],'date':e['date'],'name':r['display_name'],'course':r['course_label'],'mapping':m,'fields':r['fields']}
    def read_target(self,client,e):
        return self.target(client.read(e['date'],self.mappings[e['studentId']]['tutor_pri_no']),e)
    def path(self,request_id):
        if not isinstance(request_id,str) or not UUID.fullmatch(request_id):raise ValueError('ACADEMY_REQUEST_ID')
        p=self.state/(request_id+'.json')
        if p.is_symlink():raise ValueError('ACADEMY_ATTEMPT_UNSAFE')
        return p
    def retain(self,a):
        a['updatedAt']=datetime.now(timezone.utc).isoformat()
        p=self.path(a['requestId']);temporary=p.with_suffix('.pending')
        with temporary.open('w') as handle:json.dump(a,handle,ensure_ascii=False,indent=2);handle.flush();os.fsync(handle.fileno())
        os.chmod(temporary,0o600);temporary.replace(p)
    def summary(self,a):
        return {k:a[k] for k in ('requestId','entryId','studentId','date','state','before','desired','changedFields','observations','updatedAt') if k in a}
    def attempts(self,entry_id):
        values=[]
        for p in self.state.glob('*.json'):
            if p.is_symlink():raise ValueError('ACADEMY_ATTEMPT_UNSAFE')
            a=json.loads(p.read_text())
            if a['entryId']==entry_id:values.append(a)
        return sorted(values,key=lambda a:a['updatedAt'])
    def preview(self,entry_id):
        e=self.entry(entry_id)
        prior=self.attempts(entry_id)
        if any(a['state'] in ('applying','unknown','partial') for a in prior):raise ValueError('ACADEMY_REQUERY_UNKNOWN_FIRST')
        with self.client_factory() as client:before=self.read_target(client,e)
        desired=dict(before['fields']);desired.update({k:e['fields'][k] for k in ('progress','homework')})
        # Optional blank memo means preserve, not silently erase an existing memo.
        if e['fields']['class_memo'].strip():desired['class_memo']=e['fields']['class_memo']
        changed=[k for k in FIELDS if before['fields'][k]!=desired[k]]
        a={'requestId':str(uuid.uuid4()),'entryId':entry_id,'studentId':e['studentId'],'date':e['date'],'entry':e,'entryDigest':digest(e),'state':'prepared' if changed else 'already_equal','before':before,'desired':desired,'changedFields':changed,'observations':[]}
        self.retain(a);return self.summary(a)
    def attempt(self,request_id,entry_id):
        a=json.loads(self.path(request_id).read_text())
        if a['entryId']!=entry_id:raise ValueError('ACADEMY_REQUEST_SUBJECT')
        return a
    def status(self,entry_id,request_id=None):
        if not UUID.fullmatch(entry_id):raise ValueError('ACADEMY_SOURCE_ID')
        attempts=self.attempts(entry_id)
        if request_id:a=self.attempt(request_id,entry_id)
        elif attempts:a=attempts[-1]
        else:return {'state':'not_applied','entryId':entry_id}
        with self.client_factory() as client:current=self.read_target(client,a['entry'])
        same_identity={k:v for k,v in current.items() if k!='fields'}=={k:v for k,v in a['before'].items() if k!='fields'}
        matches=same_identity and all(current['fields'][k]==a['desired'][k] for k in a['changedFields'])
        a['observations'].append({'kind':'independent_requery','source':current})
        if a['state'] in ('applying','unknown','partial'):
            a['state']='verified' if matches else 'not_applied' if current==a['before'] else 'conflict'
        elif a['state']=='verified' and not matches:a['state']='changed_after_verification'
        self.retain(a)
        return self.summary(a)
    def apply(self,entry_id,request_id):
        a=self.attempt(request_id,entry_id)
        if a['state'] in ('verified','already_equal'):return self.status(entry_id,request_id)
        if a['state']!='prepared':raise ValueError('ACADEMY_REQUERY_BEFORE_RETRY')
        e=self.entry(entry_id)
        if digest(e)!=a['entryDigest']:raise ValueError('REVIEWED_SOURCE_CHANGED')
        expected=json.loads(json.dumps(a['before']))
        with self.client_factory() as client:
            current=self.read_target(client,e)
            if current!=expected:
                a['state']='conflict';a['observations'].append({'kind':'before_conflict','source':current});self.retain(a);return self.summary(a)
            a['state']='applying';self.retain(a)
            for field in a['changedFields']:
                issued=False
                try:
                    if digest(self.entry(entry_id))!=a['entryDigest']:raise ValueError('REVIEWED_SOURCE_CHANGED')
                    current=self.read_target(client,e)
                    if current!=expected:raise ValueError('ACADEMY_SOURCE_CHANGED')
                    a['observations'].append({'kind':'write_intent','field':field,'before':current['fields'][field],'desired':a['desired'][field]});self.retain(a)
                    issued=True
                    client.write_field(current,field,a['desired'][field])
                    expected['fields'][field]=a['desired'][field]
                    after=self.read_target(client,e)
                    a['observations'].append({'kind':'field_requery','field':field,'source':after})
                    if after!=expected:raise ValueError('ACADEMY_WRITE_RESULT_UNKNOWN')
                    self.retain(a)
                except Exception:
                    a['state']='unknown' if issued else 'partial' if any(o['kind']=='field_requery' for o in a['observations']) else 'conflict'
                    self.retain(a)
                    return self.summary(a)
            final=self.read_target(client,e)
            a['observations'].append({'kind':'final_requery','source':final})
            a['state']='verified' if final==expected else 'partial'
            self.retain(a);return self.summary(a)
    def handle(self,payload):
        if not isinstance(payload,dict):raise ValueError('ACADEMY_INPUT')
        action=payload.get('action');allowed={'action','entryId'}|({'requestId'} if action in ('apply','status') else set())
        if set(payload)-allowed or action not in ('preview','apply','status'):raise ValueError('ACADEMY_INPUT')
        with self.lock:
            if action=='preview':return self.preview(payload.get('entryId'))
            if action=='apply':return self.apply(payload.get('entryId'),payload.get('requestId'))
            return self.status(payload.get('entryId'),payload.get('requestId'))

"""SPT original-file validation and bounded native-owned ElevenLabs transcription.
No user-controlled command/URL, no LLM endpoint, no credential return or mirror.
"""
from __future__ import annotations
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import urllib.request

MAX_BYTES=67108864
MAX_SECONDS=10800
IMPORT_PROTOCOL='spt.audio-import.v2'
STT_URL='https://api.elevenlabs.io/v1/speech-to-text'
UUID=re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def write_json(path,value):
    temporary=path.with_suffix('.pending')
    temporary.write_text(json.dumps(value,ensure_ascii=False))
    temporary.replace(path)


def elevenlabs(file:Path,name:str,mime:str,key:str):
    import requests
    with file.open('rb') as stream:
        response=requests.post(STT_URL,headers={'xi-api-key':key},
            files={'file':(name,stream,mime)},data={'model_id':'scribe_v2','language_code':'ko',
                'diarize':'false','tag_audio_events':'false','no_verbatim':'false','use_multi_channel':'false','timestamps_granularity':'word'},
            timeout=(10,120),allow_redirects=False)
    if response.status_code!=200:
        raise ValueError('ELEVENLABS_RESULT_UNCONFIRMED')
    result=response.json()
    if not isinstance(result.get('text'),str) or not result['text'].strip() or len(result['text'])>100000:
        raise ValueError('TRANSCRIPT_NOT_USABLE')
    # Never persist an echoed credential even in unexpected provider output.
    if key in json.dumps(result,ensure_ascii=False):
        raise ValueError('UNEXPECTED_CREDENTIAL_ECHO')
    return result


class AudioImporter:
    def __init__(self,state:Path,owner:str,worker_token:str,key_getter,limit=8,worker_port=4173,provider=elevenlabs,max_seconds=MAX_SECONDS,resume_usage=False):
        if isinstance(max_seconds,bool) or not isinstance(max_seconds,(int,float)) or not math.isfinite(max_seconds) or not 0<max_seconds<=MAX_SECONDS:
            raise ValueError('IMPORT_DURATION_BOUND')
        self.root=state/'file-imports'
        self.owner,self.worker_token,self.key_getter=owner,worker_token,key_getter
        self.limit,self.calls,self.worker_port,self.provider=limit,0,worker_port,provider
        self.max_seconds=max_seconds
        if resume_usage:
            for path in self.root.glob('*/*/request.json'):
                started=json.loads(path.read_text())['provider_call_started']
                if not isinstance(started,bool):raise ValueError('IMPORT_USAGE_UNCONFIRMED')
                self.calls+=int(started)
        self.lock=threading.Lock()
        self.slots=threading.BoundedSemaphore(2)
        self.closed=False
        self.children=[]
        self.opener=urllib.request.build_opener(NoRedirect())

    def get(self,path):
        request=urllib.request.Request(f'http://127.0.0.1:{self.worker_port}'+path,
            headers={'x-spt-backend-token':self.worker_token,'Accept':'application/json'})
        return self.opener.open(request,timeout=40)

    def capabilities(self):
        # Permission to attempt STT, not proof of credentials/provider readiness.
        # Original-only validation and capability reads never obtain a key.
        with self.lock:
            reason='stopped' if self.closed else 'disabled' if self.limit==0 else 'exhausted' if self.calls>=self.limit else 'permitted'
            return {'protocol':IMPORT_PROTOCOL,'ready':not self.closed,'transcribeAllowed':reason=='permitted','reason':reason}

    def process(self,import_id,attempt_id,recover=False,operation='finalize'):
        if not isinstance(recover,bool) or operation not in ('finalize','transcribe'):
            raise ValueError('IMPORT_OPERATION_REJECTED')
        if not isinstance(import_id,str) or not UUID.fullmatch(import_id) or not isinstance(attempt_id,str) or not UUID.fullmatch(attempt_id):
            raise ValueError('INVALID_IMPORT_ID')
        directory=self.root/import_id/attempt_id
        if recover:
            if (directory/'result.json').is_file():
                return json.loads((directory/'result.json').read_text())
            return {'status':'unknown','error':'저장된 처리 결과가 아직 없습니다. 자동 재전사는 하지 않습니다.'}
        with self.lock:
            if self.closed:raise ValueError('IMPORT_CONSUMER_STOPPED')
            if directory.exists():raise ValueError('ATTEMPT_ALREADY_CONSUMED')
            directory.mkdir(parents=True,mode=0o700)
        audit={'importId':import_id,'attemptId':attempt_id,'operation':operation,'provider_call_started':False,'automaticRetry':False,'cost':'unknown'}
        write_json(directory/'request.json',audit)
        if not self.slots.acquire(timeout=20):raise ValueError('IMPORT_CAPACITY')
        try:
            with self.get('/api/audio-import?id='+import_id) as response:metadata=json.load(response)
            if metadata.get('id')!=import_id or metadata.get('attempt_id')!=attempt_id or metadata.get('status')!='processing':
                raise ValueError('IMPORT_BINDING_CHANGED')
            size=metadata.get('size')
            if not isinstance(size,int) or not 0<size<=MAX_BYTES:raise ValueError('IMPORT_SIZE_LIMIT')
            source=directory/'original.audio'
            digest=hashlib.sha256();received=0
            with self.get('/api/audio-import?id='+import_id+'&original=1') as response,source.open('xb') as target:
                while block:=response.read(1048576):
                    received+=len(block)
                    if received>size:raise ValueError('ORIGINAL_SIZE_CHANGED')
                    target.write(block);digest.update(block)
            if received!=size:raise ValueError('ORIGINAL_INCOMPLETE')
            command=['/usr/bin/ffprobe','-v','error','-protocol_whitelist','file,pipe',
                     '-format_whitelist','mov,mp3,wav,aac,caf,flac,ogg,matroska,webm',
                     '-enable_drefs','0','-use_absolute_path','0','-max_alloc','268435456',
                     '-show_entries','format=duration,format_name:stream=codec_type,codec_name',
                     '-of','json',str(source)]
            environment={k:os.environ[k] for k in ('PATH','LANG','LC_ALL','TZ') if k in os.environ}
            with self.lock:
                if self.closed:raise ValueError('IMPORT_CONSUMER_STOPPED')
                child=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=environment,start_new_session=True)
                self.children.append(child)
            try:stdout,_stderr=child.communicate(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid,signal.SIGKILL);child.communicate();raise ValueError('MEDIA_PROBE_TIMEOUT') from None
            try:
                if child.returncode:raise ValueError('MEDIA_UNSUPPORTED')
                info=json.loads(stdout);streams=info.get('streams',[]);duration=float(info.get('format',{}).get('duration','nan'))
                if not streams or any(s.get('codec_type')!='audio' for s in streams) or not math.isfinite(duration) or not .1<=duration<=MAX_SECONDS:
                    raise ValueError('MEDIA_UNSUPPORTED')
            except (ValueError,TypeError,KeyError):
                answer={'status':'invalid','operation':operation,'error':'지원하지 않는 녹음 파일이거나 길이를 확인할 수 없습니다. 원본은 보존합니다.','providerCallPerformed':False}
                write_json(directory/'result.json',answer);return answer
            answer={'status':'stored','operation':operation,'duration':duration,'originalSha256':digest.hexdigest(),'providerCallPerformed':False}
            if operation=='finalize':
                write_json(directory/'result.json',answer);return answer
            # Media download/probing can outlive the API's initial source read.
            # Recheck the same active claim and retained evidence before a key
            # or provider is touched; a late transcript is not a new STT need.
            with self.get('/api/audio-import?id='+import_id) as response:current=json.load(response)
            evidence=current.get('transcription')
            if current.get('id')!=import_id or current.get('attempt_id')!=attempt_id or current.get('status')!='processing' or current.get('session_id')!=metadata.get('session_id') or not isinstance(evidence,dict) or evidence.get('state')!='not_found' or evidence.get('entryIds')!=[]:
                answer['error']='보관된 전사와 원본 연결을 먼저 확인하세요. 새 전사는 요청하지 않았습니다.'
                write_json(directory/'result.json',answer);return answer
            if duration>self.max_seconds:
                answer['error']='이 실행의 음성 길이 한도를 넘었습니다. 원본은 보존하며 전사하지 않습니다.'
                write_json(directory/'result.json',answer);return answer
            if not self.capabilities()['transcribeAllowed']:
                answer['error']='이 실행 단위에서는 새 전사를 요청할 수 없습니다. 원본은 보존합니다.'
                write_json(directory/'result.json',answer);return answer
            key=self.key_getter()
            if not key:
                answer['error']='원본 보관 완료. Hermes의 ElevenLabs 키 등록 후 전사할 수 있습니다.'
            else:
                if not isinstance(key,str) or not 16<=len(key)<=1024 or any(c.isspace() for c in key):
                    raise ValueError('NATIVE_CREDENTIAL_INVALID')
                with self.lock:
                    if self.closed:raise ValueError('IMPORT_CONSUMER_STOPPED')
                    if self.calls>=self.limit:
                        answer['error']='이 실행 단위의 전사 한도에 도달했습니다. 원본은 보존합니다.'
                        write_json(directory/'result.json',answer);return answer
                    self.calls+=1
                audit['provider_call_started']=True;write_json(directory/'request.json',audit)
                result=self.provider(source,metadata['filename'],metadata['mime'],key)
                write_json(directory/'provider-result.json',result)
                answer.update({'status':'transcribed','text':result['text'],'providerCallPerformed':True})
            write_json(directory/'result.json',answer)
            return answer
        except Exception as error:
            answer={'status':'unknown','operation':operation,'error':'원본 처리 결과를 확인하지 못했습니다. 원본과 시도 이력을 보존하며 자동 재전사는 하지 않습니다.','errorType':type(error).__name__,'providerCallPerformed':audit['provider_call_started']}
            write_json(directory/'result.json',answer)
            return answer
        finally:self.slots.release()

    def stop(self):
        with self.lock:self.closed=True;children=list(self.children)
        for child in children:
            if child.poll() is None:os.killpg(child.pid,signal.SIGTERM)

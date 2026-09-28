import {env} from 'cloudflare:workers';
import {db,bucket,ApiError,sha,ownedSession} from './server';
import {uuid} from './notebook';
import {AUDIO_IMPORT_MAX_BYTES,AUDIO_IMPORT_PART_BYTES,type AudioImport,type ImportOperation,type ImportProcessor} from './audio-import-model';
import {importTranscription,type ImportTranscriptEntry} from './audio-import-state';

type StoredImport=AudioImport&{owner:string};
type Part={seq:number;size:number;hash:string;object_key:string};
export async function ownedImport(id:string,user:string){
 if(!uuid(id))throw new ApiError('녹음 연결 ID를 확인해 주세요.');
 const row=await db().prepare('SELECT * FROM spt_audio_imports WHERE id=? AND owner=?').bind(id,user).first<StoredImport>();
 if(!row)throw new ApiError('이 계정의 녹음 연결을 찾을 수 없습니다.',404);
 return row;
}
export async function importParts(id:string,user:string){return (await db().prepare('SELECT seq,size,hash,object_key FROM spt_audio_import_parts WHERE import_id=? AND owner=? ORDER BY seq').bind(id,user).all<Part>()).results;}
export async function importView(row:StoredImport){
 const entries=(await db().prepare('SELECT id,owner,session_id,capture_id,kind,body FROM spt_entries WHERE owner=? AND (capture_id=? OR id=?) ORDER BY created_at,id').bind(row.owner,row.id,row.transcript_id).all<ImportTranscriptEntry>()).results;
 const {owner:_owner,...safe}=row;
 return {...safe,transcription:importTranscription(row,entries)};
}
function completeParts(row:StoredImport,parts:Part[]){
 if(!row.size||parts.some((p,i)=>p.seq!==i)||parts.reduce((n,p)=>n+p.size,0)!==row.size)throw new ApiError('원본의 일부 구간이 아직 보관되지 않았습니다. 같은 파일로 이어 올려 주세요.',409);
}
export async function originalAudio(request:Request,row:StoredImport){
 const parts=await importParts(row.id,row.owner);completeParts(row,parts);
 const total=row.size!;let start=0,end=total-1,status=200;
 const range=request.headers.get('Range');
 if(range){
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match||!match[1]&&!match[2])throw new ApiError('지원하지 않는 음성 범위입니다.',416);
  if(match[1]){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}
  else start=Math.max(0,total-Number(match[2]));
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=total)throw new ApiError('음성 범위를 확인해 주세요.',416);
  status=206;
 }
 const store=bucket();let offset=0,index=0;
 const stream=new ReadableStream<Uint8Array>({async pull(controller){
  try{
   while(index<parts.length){const part=parts[index++],partStart=offset;offset+=part.size;if(offset<=start)continue;if(partStart>end)break;
    const obj=await store.get(part.object_key);if(!obj)throw new Error('ORIGINAL_PART_MISSING');
    const bytes=await new Response(obj.body).arrayBuffer();if(bytes.byteLength!==part.size||await sha(bytes)!==part.hash)throw new Error('ORIGINAL_PART_CHANGED');
    controller.enqueue(new Uint8Array(bytes).slice(Math.max(0,start-partStart),Math.min(part.size,end-partStart+1)));return;
   }
   controller.close();
  }catch(error){controller.error(error);}
 }});
 const filename=`SPT-${row.id}.${row.filename?.split('.').at(-1)?.replace(/[^a-zA-Z0-9]/g,'')||'audio'}`;
 const headers:Record<string,string>={'Content-Type':row.mime||'application/octet-stream','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`${new URL(request.url).searchParams.get('play')==='1'&&row.status!=='invalid'?'inline':'attachment'}; filename="${filename}"`};
 if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${total}`;
 return new Response(stream,{status,headers});
}
export async function prepareImport(user:string,id:string,sessionId:string){
 if(!uuid(id)||!uuid(sessionId))throw new ApiError('대화와 녹음 연결 ID를 확인해 주세요.');
 const session=await ownedSession(sessionId,user);
 const existing=await db().prepare('SELECT owner,session_id FROM spt_audio_imports WHERE id=?').bind(id).first<{owner:string;session_id:string}>();
 if(existing){if(existing.owner!==user||existing.session_id!==sessionId)throw new ApiError('이미 정한 녹음 대상을 바꿀 수 없습니다.',409);return ownedImport(id,user);}
 if(session.ended_at)throw new ApiError('마친 대화입니다. 새 대화를 준비해 주세요.',409);
 const now=new Date().toISOString();await db().prepare("INSERT OR IGNORE INTO spt_audio_imports(id,owner,session_id,status,created_at,updated_at) VALUES(?,?,?,'prepared',?,?)").bind(id,user,sessionId,now,now).run();
 const row=await ownedImport(id,user);if(row.session_id!==sessionId)throw new ApiError('녹음 대상이 다릅니다.',409);return row;
}
export async function bindImportFile(user:string,id:string,filename:unknown,mime:unknown,size:unknown){
 const row=await ownedImport(id,user);
 if(typeof filename!=='string'||filename.length<1||filename.length>255||/[\r\n\0]/.test(filename)||!Number.isSafeInteger(size)||Number(size)<1||Number(size)>AUDIO_IMPORT_MAX_BYTES)throw new ApiError('원본 파일 이름과 크기를 확인해 주세요. 최대 64 MiB입니다.',413);
 const ext=filename.split('.').at(-1)?.toLowerCase();const mimes:Record<string,string>={m4a:'audio/mp4',mp4:'audio/mp4',wav:'audio/wav',mp3:'audio/mpeg',aac:'audio/aac',caf:'audio/x-caf',flac:'audio/flac',ogg:'audio/ogg',webm:'audio/webm'};
 if(!ext||!mimes[ext]||typeof mime!=='string')throw new ApiError('지원하는 녹음 파일을 선택해 주세요.');
 const actualMime=mimes[ext]; // A declared type only; native media probing must validate it before STT.
 if(row.filename!==null){if(row.filename!==filename||row.size!==size||row.mime!==actualMime)throw new ApiError('다른 파일로 바꿀 수 없습니다. 새 녹음 연결을 준비해 주세요.',409);return row;}
 await db().prepare("UPDATE spt_audio_imports SET filename=?,mime=?,size=?,status='uploading',updated_at=? WHERE id=? AND owner=? AND status='prepared' AND filename IS NULL").bind(filename,actualMime,size,new Date().toISOString(),id,user).run();
 const after=await ownedImport(id,user);if(after.filename!==filename||after.size!==size)throw new ApiError('다른 창에서 다른 파일을 선택했습니다.',409);return after;
}
export async function putImportPart(user:string,id:string,seq:number,bytes:ArrayBuffer){
 const row=await ownedImport(id,user);
 if(!row.size||!Number.isSafeInteger(seq)||seq<0||seq>=Math.ceil(row.size/AUDIO_IMPORT_PART_BYTES)||bytes.byteLength!==Math.min(AUDIO_IMPORT_PART_BYTES,row.size-seq*AUDIO_IMPORT_PART_BYTES))throw new ApiError('원본 파일 구간이 올바르지 않습니다.',413);
 const digest=await sha(bytes),partId=`${id}-${seq}`;
 const old=await db().prepare('SELECT owner,hash FROM spt_audio_import_parts WHERE id=?').bind(partId).first<{owner:string;hash:string}>();
 if(old){if(old.owner!==user||old.hash!==digest)throw new ApiError('같은 원본 구간의 내용이 다릅니다.',409);return;}
 if(row.status!=='uploading')throw new ApiError('원본 보관 단계가 아닙니다.',409);
 const key=`spt/${user}/original/${id}/${seq}`;const stored=await bucket().put(key,bytes,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{sha256:digest},onlyIf:{etagDoesNotMatch:'*'}});
 if(!stored&&(await bucket().head(key))?.customMetadata?.sha256!==digest)throw new ApiError('기존 원본을 덮어쓸 수 없습니다.',409);
 await db().prepare('INSERT OR IGNORE INTO spt_audio_import_parts(id,owner,import_id,seq,size,hash,object_key) VALUES(?,?,?,?,?,?,?)').bind(partId,user,id,seq,bytes.byteLength,digest,key).run();
 const check=(await importParts(id,user)).find(p=>p.seq===seq);if(check?.hash!==digest)throw new ApiError('원본 보관 결과를 확인해 주세요.',409);
}

type ImportResult={status:'stored'|'transcribed'|'invalid'|'unknown';operation?:'finalize'|'transcribe';duration?:number;text?:string;error?:string;providerCallPerformed?:boolean;originalSha256?:string};
async function eventId(value:string){const h=await sha(new TextEncoder().encode(value).buffer);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
function processor(user:string){const e=env as unknown as Record<string,unknown>;if(e.SPT_AUDIO_IMPORT_OWNER_KEY!==user||!['http://127.0.0.1:4176/audio-import','http://127.0.0.1:4182/audio-import'].includes(String(e.SPT_AUDIO_IMPORT_URL))||typeof e.SPT_AUDIO_IMPORT_TOKEN!=='string'||e.SPT_AUDIO_IMPORT_TOKEN.length<32)throw new ApiError('이 실행본의 녹음 파일 처리 연결이 준비되지 않았습니다.',503);return {url:String(e.SPT_AUDIO_IMPORT_URL),headers:{'Content-Type':'application/json','X-SPT-Owner':user,Authorization:'Bearer '+e.SPT_AUDIO_IMPORT_TOKEN}};}
async function readProcessor(config:ReturnType<typeof processor>):Promise<ImportProcessor>{
 const response=await fetch(config.url,{method:'POST',headers:config.headers,body:JSON.stringify({action:'capabilities'}),signal:AbortSignal.timeout(4000)});
 const p=await response.json() as Record<string,unknown>;
 if(!response.ok||p.protocol!=='spt.audio-import.v2'||typeof p.ready!=='boolean'||typeof p.transcribeAllowed!=='boolean'||!['permitted','disabled','exhausted','stopped'].includes(String(p.reason))||p.transcribeAllowed!==(p.ready&&p.reason==='permitted'))throw new ApiError('원본 보관과 전사를 분리하는 처리 연결을 확인해 주세요.',503);
 return {ready:p.ready,transcribeAllowed:p.transcribeAllowed,reason:p.reason as ImportProcessor['reason']};
}
export async function importProcessor(user:string):Promise<ImportProcessor>{
 try{return await readProcessor(processor(user));}catch{return {ready:false,transcribeAllowed:false,reason:'unavailable'};}
}
async function saveImportResult(user:string,row:StoredImport,answer:ImportResult){
 if(!['stored','transcribed','invalid'].includes(answer.status)||answer.status!=='invalid'&&(!Number.isFinite(answer.duration)||answer.duration!<=0||answer.duration!>10800)||answer.status==='transcribed'&&(typeof answer.text!=='string'||!answer.text.trim()||answer.text.length>100000))throw new ApiError('녹음 파일 처리 결과를 확인하지 못했습니다.',502);
 const now=new Date().toISOString(),transcriptId=await eventId(row.attempt_id+':transcript'),noticeId=await eventId(row.id+':notice');
 const statements=[db().prepare('UPDATE spt_audio_imports SET status=?,duration=?,transcript_id=?,error=?,updated_at=? WHERE id=? AND owner=? AND attempt_id=? AND status IN (\'processing\',\'unknown\')').bind(answer.status,answer.duration||null,answer.status==='transcribed'?transcriptId:null,answer.error||null,now,row.id,user,row.attempt_id)];
 if(answer.status!=='invalid'){
  statements.push(db().prepare("INSERT OR IGNORE INTO spt_captures(id,owner,session_id,state,created_at,ended_at) SELECT ?,?,?,'ended',?,? WHERE EXISTS(SELECT 1 FROM spt_audio_imports WHERE id=? AND owner=? AND attempt_id=?)").bind(row.id,user,row.session_id,now,now,row.id,user,row.attempt_id));
  statements.push(db().prepare("INSERT OR IGNORE INTO spt_entries(id,owner,session_id,kind,body,capture_id,created_at,schema_version) SELECT ?,?,?,'recording_notice',?,?,?,1 WHERE EXISTS(SELECT 1 FROM spt_audio_imports WHERE id=? AND owner=? AND attempt_id=?)").bind(noticeId,user,row.session_id,JSON.stringify({text:`녹음 파일을 가져왔습니다. 원본: ${row.filename}. 녹음 시각은 자동 추정하지 않으며 아래 시각은 가져오기 시각입니다. 원본 연결 ID: ${row.id}`,originalAudioId:row.id,originalSha256:answer.originalSha256,source:'file_import',recordedAt:'unknown',importedAt:now}),row.id,now,row.id,user,row.attempt_id));
  if(answer.status==='transcribed')statements.push(db().prepare("INSERT OR IGNORE INTO spt_entries(id,owner,session_id,kind,body,capture_id,created_at,schema_version) SELECT ?,?,?,'transcript',?,?,?,1 WHERE EXISTS(SELECT 1 FROM spt_audio_imports WHERE id=? AND owner=? AND attempt_id=?)").bind(transcriptId,user,row.session_id,JSON.stringify({text:answer.text,originalAudioId:row.id,source:'elevenlabs_file_stt'}),row.id,now,row.id,user,row.attempt_id));
 }
 await db().batch(statements);
}
export async function processImport(user:string,id:string,operation:ImportOperation='finalize'){
 let row=await ownedImport(id,user);const view=await importView(row);
 const recover=operation==='recover',transcribe=operation==='transcribe';
 if(view.transcription.state==='available'&&(transcribe||['stored','transcribed'].includes(row.status)))return view;
 if(view.transcription.state==='needs_review'&&operation!=='finalize')throw new ApiError('보관된 전사와 원본 연결을 먼저 대조해 주세요. 새 전사는 요청하지 않습니다.',409);
 if(row.status==='transcribed'||row.status==='invalid'||operation==='finalize'&&row.status==='stored')return view;
 if(recover&&(!row.attempt_id||!['processing','unknown'].includes(row.status)))return view;
 const config=processor(user);
 if(!recover){
  if(!['uploading','stored'].includes(row.status))throw new ApiError('같은 전사를 자동 재요청하지 않습니다. 처리 상태를 먼저 확인해 주세요.',409);
  completeParts(row,await importParts(id,user));
  let capabilities:ImportProcessor;try{capabilities=await readProcessor(config);}catch{throw new ApiError('원본 보관과 전사를 분리하는 처리 연결을 확인해 주세요. 원본은 유지합니다.',503);}
  if(!capabilities.ready)throw new ApiError('원본 처리 연결이 중단되어 있습니다. 보관한 구간은 유지합니다.',503);
  if(transcribe&&!capabilities.transcribeAllowed)throw new ApiError('이 실행에서는 새 전사 요청이 허용되지 않습니다. 키 유무와 별개이며 원본은 보존합니다.',409);
  const attempt=crypto.randomUUID();
  const changed=await db().prepare("UPDATE spt_audio_imports SET status='processing',attempt_id=?,error=NULL,updated_at=? WHERE id=? AND owner=? AND status=? AND (?=0 OR NOT EXISTS(SELECT 1 FROM spt_entries e WHERE e.owner=? AND e.capture_id=? AND e.kind='transcript'))").bind(attempt,new Date().toISOString(),id,user,row.status,transcribe?1:0,user,id).run();
  if(changed.meta.changes!==1)return importView(await ownedImport(id,user));row=await ownedImport(id,user);
 }
 try{
  const response=await fetch(config.url,{method:'POST',headers:config.headers,body:JSON.stringify({importId:id,attemptId:row.attempt_id,recover,...(!recover?{operation:transcribe?'transcribe':'finalize'}:{})}),signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error('UNCONFIRMED');const answer=await response.json() as ImportResult;
  if(answer.status==='unknown'||!recover&&(answer.operation!==operation||!transcribe&&(answer.status==='transcribed'||answer.providerCallPerformed!==false)))throw new Error('UNCONFIRMED');await saveImportResult(user,row,answer);
 }catch{await db().prepare("UPDATE spt_audio_imports SET status='unknown',error='처리 결과 미확인: 원본은 유지되며 자동 재전사는 하지 않습니다.',updated_at=? WHERE id=? AND owner=? AND attempt_id=?").bind(new Date().toISOString(),id,user,row.attempt_id).run();}
 return importView(await ownedImport(id,user));
}

'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {AUDIO_IMPORT_MAX_BYTES,AUDIO_IMPORT_PART_BYTES,voiceMemoShortcutURL,type AudioImport,type ImportOperation,type ImportProcessor} from '@/lib/audio-import-model';
import {transferShortcutURL,type TransferGrant} from '@/lib/audio-transfer-model';

export type NativeCaptureTarget={studentId:string;date:string;sessionId:string;title:string;purpose:string;importId?:string};
type Props={target:NativeCaptureTarget;name:string;names:Record<string,string>;ensureSession:(target:NativeCaptureTarget)=>Promise<string>;onPrepared:(sessionId:string)=>void;onChanged:()=>void;onClose:()=>void};
const originalText:Record<AudioImport['status'],string>={prepared:'녹음·파일 연결 대기',uploading:'원본 구간 보관 중',processing:'원본 처리 상태 확인 중',stored:'원본 보관 완료',transcribed:'원본 보관 완료',invalid:'원본 형식 확인 필요',unknown:'처리 결과 확인 필요'};
const unavailable:ImportProcessor={ready:false,transcribeAllowed:false,reason:'unavailable'};
function stateText(row:AudioImport){
 if(row.transcription?.state==='available')return ['stored','transcribed'].includes(row.status)?'원본·전사 보관 완료':originalText[row.status]+' · 전사 별도 보관';
 if(row.transcription?.state==='needs_review')return originalText[row.status]+' · 전사·원본 연결 대조 필요';
 return originalText[row.status]+(['stored','transcribed'].includes(row.status)?row.transcription?' · 보관 전사 없음':' · 전사 연결 확인 중':'');
}
async function request<T>(url:string,init?:RequestInit):Promise<T>{const r=await fetch(url,{cache:'no-store',...init});const v:unknown=await r.json();if(!r.ok)throw new Error(v&&typeof v==='object'&&'error' in v&&typeof v.error==='string'?v.error:'요청 결과를 확인하지 못했습니다. 기존 원본은 유지합니다.');return v as T;}
const post=<T,>(body:unknown)=>request<T>('/api/audio-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function digest(bytes:ArrayBuffer){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}

export function NativeCapture(p:Props){
 const [rows,setRows]=useState<AudioImport[]>([]),[selected,setSelected]=useState(p.target.importId||''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState('');
 const [processor,setProcessor]=useState<ImportProcessor>(unavailable);
 const [transfer,setTransfer]=useState<{id:string;url:string;expiresAt:number}|null>(null);
 const [clock,setClock]=useState(0);
 const gate=useRef(false),prepared=useRef<{id:string;sessionId:string}|null>(null);
 const load=useCallback(async()=>{const v=await request<{imports:AudioImport[];processor?:ImportProcessor}>('/api/audio-import?date='+p.target.date);setRows(v.imports);setProcessor(v.processor??unavailable);},[p.target.date]);
 useEffect(()=>{let closed=false;const read=()=>request<{imports:AudioImport[];processor?:ImportProcessor}>('/api/audio-import?date='+p.target.date).then(v=>{if(!closed){setRows(v.imports);setProcessor(v.processor??unavailable);setClock(Date.now());}},e=>{if(!closed)setMessage(e instanceof Error?e.message:'녹음 연결을 불러오지 못했습니다.');});void read();const timer=setInterval(()=>void read(),3000);return()=>{closed=true;clearInterval(timer);};},[p.target.date]);
 const row=rows.find(r=>r.id===selected),targetName=row?p.names[row.student_id||'']||row.student_id:p.name;
 const hasTranscript=row?.transcription?.state==='available';
 const activeTransfer=transfer&&row&&transfer.id===row.id&&transfer.expiresAt>clock/1000?transfer:null;
 async function prepareTransfer(id:string){if(gate.current)return;gate.current=true;setBusy(true);setTransfer(null);setMessage('');try{
  const g=await request<TransferGrant>('/api/audio-transfer/grant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
  const source=await request<AudioImport>('/api/audio-import?id='+id);const url=transferShortcutURL(g,source,window.location.origin);setClock(Date.now());setTransfer({id,url,expiresAt:g.expiresAt});setMessage('전송 연결을 준비했습니다. 최초 단축어 설정 후 아래에서 시작하세요. 녹음·전송 중에는 연결을 갱신하지 마세요.');
 }catch(e){setMessage(e instanceof Error?e.message:'전송 연결을 준비하지 못했습니다. 기존 녹음은 유지합니다.');}finally{gate.current=false;setBusy(false);}}
 async function revokeTransfer(id:string){if(gate.current)return;gate.current=true;setBusy(true);try{await request('/api/audio-transfer/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});setTransfer(null);setMessage('이 녹음의 전송 연결을 철회했습니다. 보관한 원본은 삭제하지 않았습니다.');}catch(e){setMessage(e instanceof Error?e.message:'철회 결과를 확인하지 못했습니다.');}finally{gate.current=false;setBusy(false);}}
 async function prepare(){if(gate.current)return;gate.current=true;setBusy(true);setMessage('');try{
  if(!prepared.current)prepared.current={id:crypto.randomUUID(),sessionId:await p.ensureSession(p.target)};
  const v=await post<AudioImport>({action:'prepare',...prepared.current});setSelected(v.id);p.onPrepared(v.session_id);await load();
 }catch(e){setMessage(e instanceof Error?e.message:'녹음 대상을 준비하지 못했습니다.');}finally{gate.current=false;setBusy(false);}}
 async function process(id:string,action:ImportOperation='finalize'){
  setMessage(action==='recover'?'보관된 처리 결과를 확인합니다. 새 전사는 요청하지 않습니다.':action==='transcribe'?'이 원본의 전사를 요청합니다. 학생 수행·교사 통과로 자동 반영하지 않습니다.':'원본 파일만 확인·보관합니다. 전사는 요청하지 않습니다.');
  try{await post<AudioImport>({action,id});}catch(e){setMessage(e instanceof Error?e.message:'응답을 확인하지 못했습니다. 처리 상태 확인을 사용하세요.');}
  try{await load();p.onChanged();}catch(e){setMessage(e instanceof Error?e.message:'보관 결과를 다시 읽지 못했습니다. 원본을 유지하고 같은 녹음의 상태를 확인해 주세요.');}
 }
 async function act(id:string,action:ImportOperation){if(gate.current)return;gate.current=true;setBusy(true);try{await process(id,action);}finally{gate.current=false;setBusy(false);}}
 async function upload(file:File,id:string){
  if(gate.current)return;gate.current=true;setBusy(true);setMessage('');
  try{
   if(!file.size||file.size>AUDIO_IMPORT_MAX_BYTES)throw new Error('64 MiB 이하의 녹음 원본을 선택해 주세요. 원본 앱의 파일은 삭제하지 마세요.');
   await post<AudioImport>({action:'file',id,filename:file.name,mime:file.type,size:file.size});
   const saved=await request<AudioImport>('/api/audio-import?id='+id),parts=saved.parts||[];
   for(let start=0,seq=0;start<file.size;start+=AUDIO_IMPORT_PART_BYTES,seq++){
    const bytes=await file.slice(start,start+AUDIO_IMPORT_PART_BYTES).arrayBuffer(),hash=await digest(bytes),prior=parts.find(v=>v.seq===seq);
    if(prior&&prior.hash!==hash)throw new Error('이미 보관한 원본과 다른 파일입니다. 이 연결은 유지하고 새 녹음 연결을 준비해 주세요.');
    if(!prior)await request('/api/audio-import?id='+id+'&part='+seq,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes});
    setProgress(`${Math.min(file.size,start+bytes.byteLength)} / ${file.size} 바이트 보관 확인`);
   }
   await process(id);
  }catch(e){setMessage(e instanceof Error?e.message:'원본 연결을 마치지 못했습니다. 같은 파일로 이어 올릴 수 있습니다.');await load().catch(()=>{});}
  finally{gate.current=false;setBusy(false);setProgress('');}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)p.onClose();}}><DialogContent className="wide-dialog native-capture-dialog"><DialogHeader><DialogTitle>{targetName||p.name} · 음성 메모 녹음</DialogTitle><DialogDescription>{p.target.date} · {(row?.session_purpose??p.target.purpose)==='test'?'테스트 기록 · 수업 정리에서 제외':'이 학생의 대화에 연결합니다. 화면에서 다른 학생을 보더라도 이 녹음 대상은 바뀌지 않습니다.'}</DialogDescription></DialogHeader>
 <p>화면을 잠가도 녹음하려면 음성 메모를 사용합니다. SPT는 음성 메모의 녹음·중단 상태를 실시간으로 읽지 않습니다.</p>
 {!selected&&<button className="primary" disabled={busy} onClick={()=>void prepare()}>이 학생의 녹음 준비</button>}
 {row&&<section className="native-import-selected" aria-label="고정된 녹음 대상"><h3>{targetName} · {row.class_date} · {row.session_title}</h3><p role="status">{stateText(row)}</p>
 {['prepared','uploading'].includes(row.status)&&<section aria-label="단축어 자동 전송"><h4>기기 보관 → 자동 전송</h4><p><a href="/shortcut-setup" target="_blank" rel="noreferrer">최초 1회 단축어 설정 안내</a> · 기기 안의 SPT 폴더에 원본을 보관합니다. 자동 삭제하지 않습니다.</p><button disabled={busy} onClick={()=>void prepareTransfer(row.id)}>자동 전송 연결 준비</button>{activeTransfer&&<><p><a className="primary native-record-link" href={activeTransfer.url}>녹음·자동 전송 시작</a></p><p className="hint">이 녹음에만 유효 · {new Date(activeTransfer.expiresAt*1000).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}까지. 같은 녹음 폴더에 파일이 있으면 재녹음하지 않고 그 파일을 전송합니다.</p><button disabled={busy} onClick={()=>void revokeTransfer(row.id)}>전송 연결 철회</button></>}</section>}
 {row.status==='prepared'&&<><a className="native-record-link" href={voiceMemoShortcutURL()}>기존 단축어로 녹음 · 수동 연결</a><p className="hint">등록한 ‘SPT 녹음’ 단축어를 실행합니다. 녹음은 음성 메모 안에서 멈추세요. 녹음 중 다른 오디오를 재생하지 마세요.</p></>}
 {['prepared','uploading'].includes(row.status)&&<><p><strong>수동 연결이 필요한 경우:</strong> 녹음이 끝나면 <strong>음성 메모 → 해당 녹음의 더 보기 → 공유 → 파일에 저장</strong> 후 아래에서 선택하세요. 이 녹음의 주대상 학생에 연결하며, 끼어든 다른 학생의 말은 화자 미확인으로 남깁니다.</p><label className="field">{targetName}의 원본 파일<input type="file" accept="audio/*,.m4a,.caf" disabled={busy} onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void upload(f,row.id);e.currentTarget.value='';}}/></label>{row.filename&&<p>이 연결의 원본 · {row.filename}. 중단됐다면 같은 파일을 다시 선택해 이어 올립니다. 파일 전송은 전사 요청과 별개입니다.</p>}</>}
 {row.error&&(hasTranscript?<details><summary>이전 처리 결과</summary><p>{row.error}</p></details>:<p role="status" className="notice">{row.error}</p>)}
 {row.status==='uploading'&&row.filename&&<button disabled={busy||!processor.ready} onClick={()=>void act(row.id,'finalize')}>보관한 원본 확인 · 전사 없음</button>}
 {row.filename&&['stored','transcribed','invalid','unknown','processing'].includes(row.status)&&<p><a href={'/api/audio-import?id='+row.id+'&original=1'} target="_blank" rel="noreferrer">보관한 원본 내려받기</a></p>}
 {['stored','transcribed'].includes(row.status)&&<><audio controls preload="none" src={'/api/audio-import?id='+row.id+'&original=1&play=1'} aria-label={targetName+' 보관한 원음'}/><p>{row.duration?.toFixed(1)}초 · 녹음 시각은 추정하지 않습니다.</p></>}
 {hasTranscript&&<p>이 원본에 연결된 전사 {row.transcription!.entryIds.length}개를 보관하고 있습니다. 관찰·대화에서 대조하세요. 다시 전사하지 않습니다.</p>}
 {row.transcription?.state==='needs_review'&&<p className="notice">보관 전사와 원본 연결을 먼저 대조해야 합니다. 다른 녹음의 전사를 가져오거나 새 전사를 자동 요청하지 않습니다.</p>}
 {row.status==='stored'&&row.transcription?.state==='not_found'&&<><button disabled={busy||!processor.transcribeAllowed} onClick={()=>void act(row.id,'transcribe')}>전사 요청</button><p className="hint">{processor.transcribeAllowed?'이 실행에서 허용한 범위의 전사만 명시적으로 요청합니다.':processor.reason==='disabled'||processor.reason==='exhausted'?'현재 실행에서는 새 전사 요청이 허용되지 않습니다. 키 등록과 별개이며 원본 보관은 가능합니다.':'전사 처리 연결을 확인해 주세요. 보관한 원본은 유지됩니다.'}</p></>}
 {['processing','unknown'].includes(row.status)&&row.transcription?.state!=='needs_review'&&<button disabled={busy} onClick={()=>void act(row.id,'recover')}>처리 상태 확인 · 새 전사 없음</button>}
 </section>}
 {progress&&<p role="status">{progress}</p>}{message&&<p role="status">{message}</p>}
 <details open={!row}><summary>이 수업일의 녹음 연결 {rows.length}개</summary><div className="native-import-list">{rows.map(item=><button key={item.id} disabled={busy} aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}><strong>{p.names[item.student_id||'']||item.student_id} · {item.session_title}</strong><span>{item.filename||'파일 연결 전'} · {stateText(item)}</span></button>)}</div></details>
 <div className="button-row"><button disabled={busy} onClick={()=>{prepared.current=null;setSelected('');}}>새 녹음 연결 준비</button><button disabled={busy} onClick={p.onClose}>기록장으로 돌아가기</button></div><p className="hint">원본 보관 확인 전에는 음성 메모의 녹음을 삭제하지 마세요. 앱을 닫거나 파일 전송 중 화면을 잠그면 전송은 중단될 수 있으며, 같은 파일로 이어 올릴 수 있습니다.</p>
 </DialogContent></Dialog>;
}

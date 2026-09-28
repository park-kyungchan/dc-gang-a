'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {task,type Task,type ClassEvent} from '@/lib/classroom';
import {havrutaGroups,havrutaLabel,havrutaPassed,havrutaStatePatch,type HavrutaDraft} from '@/lib/havruta';
import {retentionOf,retentionLabels} from '@/lib/classroom-view';
import type {NotebookData} from '@/lib/projection';
import type {Student} from '@/lib/notebook';
import type {DeviceOutbox} from '@/lib/outbox';
import type {ClassroomSave} from './classroom-board';

type Props={students:Student[];date:string;data:NotebookData;ready:boolean;box?:DeviceOutbox|null;save:ClassroomSave;onOpen:(id:string)=>void;fail:(e:unknown)=>void};
function empty(date:string):HavrutaDraft{return {groupId:crypto.randomUUID(),date,selected:[],members:[],assignedAt:''};}
export function HavrutaPanel(p:Props){
 const key='havruta:create:'+p.date;
 const [open,setOpen]=useState(false),[value,setValue]=useState<HavrutaDraft>(()=>p.box?.noteDraft<HavrutaDraft>(key)||empty(p.date)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const current=useRef(value),revision=useRef(value.revision||''),queue=useRef(Promise.resolve()),gate=useRef(false),latest=useRef(p);
 useLayoutEffect(()=>{latest.current=p;},[p]);
 const groups=havrutaGroups(p.data.ledger,p.date),ready=p.ready&&p.data.classroomLoaded!==false&&!!p.box;
 function retain(next:HavrutaDraft){
  current.current=next;setValue(next);p.box?.rememberNoteDraft(key,next);
  queue.current=queue.current.catch(()=>{}).then(async()=>{if(!p.box)throw new Error('기기 보관함을 먼저 확인하세요.');const rev=await p.box.saveNoteDraft(key,next,revision.current);revision.current=rev;if(current.current===next){const stored={...next,revision:rev};current.current=stored;setValue(stored);p.box.rememberNoteDraft(key,stored);}});
  void queue.current.catch(e=>{setError(e instanceof Error?e.message:'초안 보관 실패');p.fail(e);});return queue.current;
 }
 function pick(id:string){const v=current.current;if(v.members.length)return;setError('');void retain({...v,selected:v.selected.includes(id)?v.selected.filter(x=>x!==id):[...v.selected,id]});}
 async function assign(){
  if(gate.current||!ready)return;gate.current=true;setBusy(true);setError('');
  try{
   await queue.current;let v=current.current;
   if(v.date!==p.date||v.selected.length<2||v.selected.some(id=>!latest.current.students.some(s=>s.id===id)))throw new Error('이 수업의 참여 학생을 두 명 이상 직접 선택하세요.');
   if(!v.members.length){v={...v,members:v.selected.map(studentId=>({studentId,activityId:crypto.randomUUID()})),assignedAt:new Date().toISOString()};await retain(v);}
   const errors:string[]=[];
   for(const m of v.members){
    // Existing queued, blocked or acknowledged members are not re-created.
    const row=latest.current.data.ledger.find(e=>e.entity_id===m.activityId);
    if(row){const t=JSON.parse(row.body) as Task;if(row.student_id!==m.studentId||t.havruta?.groupId!==v.groupId)throw new Error('이전 배정의 학생·모둠 관계를 대조하세요.');continue;}
    const item=latest.current.data.localItems?.find(i=>i.url==='/api/classroom'&&i.payload?.entityId===m.activityId);if(item)continue;
    try{await p.save(m.studentId,'activity',m.activityId,{...task('하브루타',v.date),timing:{assignedAt:v.assignedAt,visitedAt:'',revisitAt:'',stoppedAt:''},havruta:{version:1,groupId:v.groupId,date:v.date,members:v.members,problem:{kind:'teacher_issued'},review:null}},v.date,'','event',m.activityId);}
    catch(e){errors.push((p.students.find(s=>s.id===m.studentId)?.name||m.studentId)+': '+(e instanceof Error?e.message:'보관 미확인'));}
   }
   if(errors.length)throw new Error('일부 배정은 보관되지 않았습니다. 기존 배정은 유지하며 같은 대상만 이어갑니다. '+errors.join(' / '));
   await retain(empty(p.date));setOpen(false);
  }catch(e){setError(e instanceof Error?e.message:'배정을 확인하세요.');p.fail(e);}finally{gate.current=false;setBusy(false);}
 }
 return <section className="havruta-panel" aria-label="하브루타 협동 활동">
  <div className="havruta-heading"><strong>하브루타</strong><button disabled={!ready} onClick={()=>setOpen(true)}>하브루타 모둠 배정</button></div>
  {groups.map(g=><HavrutaRound key={g.id} group={g} date={p.date} data={p.data} names={p.data.roster||p.students} save={p.save} onOpen={p.onOpen} ready={ready} fail={p.fail}/>)}
  <Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v);}}><DialogContent className="a-action-sheet translate-x-0 translate-y-0 sm:translate-x-[-50%] sm:translate-y-[-50%]"><DialogHeader><DialogTitle>하브루타 모둠 배정</DialogTitle><DialogDescription>교사 출제 문제를 함께 풀고 설명합니다. 배정은 출석·통과가 아닙니다.</DialogDescription></DialogHeader>
   <p>참여 학생을 직접 선택하세요. 수업 종료 전 활동이지만 시각으로 자동 시작·통과하지 않습니다.</p>
   <div className="havruta-members">{p.students.map(s=><label key={s.id}><input type="checkbox" checked={value.selected.includes(s.id)} disabled={busy||!!value.members.length} onChange={()=>pick(s.id)}/><span>{s.name}</span></label>)}</div>
   {value.members.length>0&&<p role="status">같은 모둠·활동 ID로 미보관 대상만 이어 배정합니다. 이미 보관한 학생은 다시 만들지 않습니다.</p>}
   <button className="primary" disabled={busy||!ready||value.selected.length<2} onClick={()=>void assign()}>{busy?'기기 보관 중…':value.members.length?'남은 대상 이어 배정':'선택 학생에게 협동문제 배정'}</button>
   <button disabled={busy||!ready} onClick={()=>void retain(empty(p.date)).then(()=>setError(''))}>새 선택으로 준비 · 기존 활동 유지</button>
   <p className="hint">닫아도 기기에 준비 내용을 보관합니다. 문제 상세·교재 범위는 배정 뒤 학생 카드에서 보완할 수 있습니다.</p>{error&&<><p role="alert">{error}</p><button disabled={busy} onClick={()=>{const stored=p.box?.storedNoteDraft<HavrutaDraft>(key);if(stored){revision.current=stored.revision||'';current.current=stored;setValue(stored);p.box?.rememberNoteDraft(key,stored);setError('');queue.current=Promise.resolve();}}}>보관된 최신 준비안 불러오기</button></>}
   {!!p.box?.recoveredNotes<HavrutaDraft>(key).length&&<details><summary>충돌로 보관한 이전 준비안</summary>{p.box.recoveredNotes<HavrutaDraft>(key).map(item=><button key={item.key} disabled={busy} onClick={()=>void retain(item.value).then(()=>setError(''))}>{item.value.selected.map(id=>p.students.find(s=>s.id===id)?.name||id).join(' · ')} 준비안 선택</button>)}</details>}
  </DialogContent></Dialog>
 </section>;
}

type Group=ReturnType<typeof havrutaGroups>[number];
export function HavrutaRound(p:{group:Group;date:string;data:NotebookData;names:Student[];save:ClassroomSave;onOpen:(id:string)=>void;ready:boolean;fail:(e:unknown)=>void}){
 const [selection,setSelection]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const gate=useRef(false),latest=useRef(p);
 useLayoutEffect(()=>{latest.current=p;},[p]);
 const available=(e:ClassEvent|undefined,t:Task|undefined,data=p.data)=>!!e&&!!t&&!t.cancelled&&t.workDate===p.date&&retentionOf(e,data.localItems)!=='blocked';
 function selectAll(){setSelection(Object.fromEntries(p.group.rows.filter(r=>available(r.event,r.task)).map(r=>[r.activityId,r.event!.id])));}
 async function act(state:Task['state']){
  if(gate.current||!p.ready)return;gate.current=true;setBusy(true);setMessage('');const accepted:string[]=[],errors:string[]=[];
  try{for(const [id,base] of Object.entries(selection)){
   const r=latest.current.group.rows.find(r=>r.activityId===id),e=r?.event,t=r?.task;
   if(!r||!available(e,t,latest.current.data)||e!.id!==base){errors.push('변경된 대상은 다시 선택하세요.');continue;}
   try{await p.save(r.studentId,'activity',id,{...t!,...havrutaStatePatch(t!,state)},e!.class_date,e!.id,'event');accepted.push(id);}catch(e){errors.push(e instanceof Error?e.message:'기기 보관 실패');}
  }
  setSelection(old=>Object.fromEntries(Object.entries(old).filter(([id])=>!accepted.includes(id))));setMessage((accepted.length?accepted.length+'명 동작을 기기에 보관했습니다. 학생별 서버 보관 상태를 확인하세요. ':'')+errors.join(' '));
  }finally{gate.current=false;setBusy(false);}
 }
 const confirmed=p.group.rows.filter(r=>r.task&&r.task.workDate===p.date&&havrutaPassed(r.task)&&retentionOf(r.event,p.data.localItems)==='server').length;
 return <details className="havruta-round" data-group-id={p.group.id}>
  <summary>협동 모둠 · 통과 서버 확인 {confirmed}/{p.group.members.length}<small>{p.group.members.map(m=>p.names.find(s=>s.id===m.studentId)?.name||m.studentId).join(' · ')}</small></summary>
  <p className="hint">확인한 학생만 선택해 통과시킵니다. 개인 발언·숙달을 자동 추정하지 않습니다.</p>
  <div className="havruta-members">{p.group.rows.map(r=>{const enabled=available(r.event,r.task),label=r.task?r.task.cancelled?'참여 취소':r.task.workDate!==p.date?'다른 수업일로 이동':havrutaLabel(r.task):'배정 보관 미확인';return <div key={r.activityId} className="havruta-member" data-member-id={r.studentId}><label><input type="checkbox" checked={!!selection[r.activityId]} disabled={busy||!p.ready||!enabled} onChange={()=>setSelection(old=>{const next={...old};if(next[r.activityId])delete next[r.activityId];else next[r.activityId]=r.event!.id;return next;})}/><span><strong>{p.names.find(s=>s.id===r.studentId)?.name||r.studentId}</strong><small>{label} · {r.event?retentionLabels[retentionOf(r.event,p.data.localItems)]:'다른 대상의 기록으로 대신 확인하지 않음'}{selection[r.activityId]&&selection[r.activityId]!==r.event?.id?' · 변경됨, 다시 선택':''}</small></span></label><button onClick={()=>p.onOpen(r.studentId)}>학생 보기</button></div>;})}</div>
  <div className="havruta-actions"><button disabled={busy||!p.ready} onClick={selectAll}>전체 선택</button><button disabled={busy} onClick={()=>setSelection({})}>선택 해제</button>{([['working','협동 풀이 시작'],['student_done','설명 요청'],['check','다시 설명 필요'],['done','설명 확인·선택 학생 통과']] as const).map(([state,label])=><button key={state} className={state==='done'?'primary':''} disabled={busy||!p.ready||!Object.keys(selection).length} onClick={()=>void act(state)}>{label}</button>)}</div>
  {message&&<p role="status">{message}</p>}
 </details>;
}

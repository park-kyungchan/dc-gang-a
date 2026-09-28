'use client';

import {useEffect,useLayoutEffect,useRef,useState,type PointerEvent,type CSSProperties} from 'react';
import {Check,ChevronRight,Clock,History,MoreHorizontal,Plus,Undo2,BookOpen,ArrowUpRight,AudioLines} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {activityChoices,blankCloseout,classPart,classStatus,entity,task,taskLabels,values,type ClassEvent,type ClassStatus,type Task} from '@/lib/classroom';
import {assignedTiming,scheduleVisit} from '@/lib/activity-time';
import {classroomView,retentionLabels,type ClassroomView} from '@/lib/classroom-view';
import {RecordProgress} from './record-progress';
import type {Student} from '@/lib/notebook';
import type {NotebookData} from '@/lib/projection';
import type {Mutation,RevisionMode,DeviceOutbox} from '@/lib/outbox';
import {ActivityClock} from './activity-clock';
import {SwipeDeleteCard} from './swipe-delete-card';
import {CurriculumAssignment,type AssignmentDraft} from './curriculum-picker';
import {catalogFromSnapshot,scopeText} from '@/lib/curriculum';
import {HomeworkPanel} from './homework-picker';
import {nextHomeworkDue} from '@/lib/homework';
import {applyActivityScope,mergeActivityScopeDraft,type ActivityScopeDraft} from '@/lib/activity-scope';
import {ActivityScopeEditor} from './activity-scope-editor';
import {HavrutaPanel} from './havruta-panel';
import {havrutaLabel,havrutaState,havrutaStatePatch} from '@/lib/havruta';

export type ClassroomSave=(studentId:string,kind:string,entityId:string,data:unknown,date?:string,baseId?:string,mode?:RevisionMode,requestId?:string)=>Promise<Mutation>;
type View='class'|'after';
type Menu={studentId:string;entityId?:string;mode:'actions'|'assign'|'history'|'activities'|'revisit'|'homework'|'scope'};
type Undo={studentId:string;kind:string;entityId:string;date:string;afterId:string;before:Task|ClassStatus;label:string};
type Props={students:Student[];date:string;ledger:ClassEvent[];data:NotebookData;selected:string;ready:boolean;view:View;box?:DeviceOutbox|null;save:ClassroomSave;onOpen:(id:string,view?:string)=>void;onAudio:(id:string)=>void;onTracker?:(id:string)=>void;fail:(e:unknown)=>void};
const displayTitle=(title:string)=>title==='DT'?'Daily Test':title;
const palettes=[['#546cc4','#edf0ff'],['#4e7b64','#eaf4ee'],['#a27126','#fff3df'],['#9267a5','#f5edf8']];
const time=(value?:string|null)=>value?new Date(value).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'입력 시각 미기록';
function eventTask(e:ClassEvent){return values(e,task('',e.class_date));}
function headline(e:ClassEvent){
 if(e.kind==='class_status'){const s=JSON.parse(e.body) as ClassStatus;return [s.instructionAt?'숙제 안내함':'안내 미표시',s.departedAt?'귀가 기록':'귀가 미표시'].join(' · ');}
 if(e.kind==='activity'){const t=eventTask(e);return `${displayTitle(t.title)} · ${t.cancelled?'활동 취소':t.havruta?havrutaLabel(t):taskLabels[t.state]}`;}
 return e.kind==='closeout'?'상세 진도·숙제 수정':'수업 기록 수정';
}

/** A held pointer opens the same visible menu; it never performs a fact write. */
function useContextHold(open:()=>void,identity:string){
 const held=useRef<{id:number;x:number;y:number;timer:ReturnType<typeof setTimeout>}|null>(null),suppress=useRef(false);
 const clear=()=>{if(held.current)clearTimeout(held.current.timer);held.current=null;};
 useEffect(()=>{clear();suppress.current=false;return clear;},[identity]);
 return {
  onPointerDown:(e:PointerEvent<HTMLButtonElement>)=>{if(e.button!==0||!e.isPrimary)return;clear();suppress.current=false;const p={id:e.pointerId,x:e.clientX,y:e.clientY,timer:setTimeout(()=>{suppress.current=true;open();},480)};held.current=p;e.currentTarget.setPointerCapture(e.pointerId);},
  onPointerMove:(e:PointerEvent<HTMLButtonElement>)=>{const p=held.current;if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>8){clear();suppress.current=true;}},
  onPointerUp:clear,onPointerCancel:()=>{clear();suppress.current=true;},onLostPointerCapture:clear,
  onClickCapture:(e:{detail:number;preventDefault:()=>void;stopPropagation:()=>void})=>{if(suppress.current&&e.detail!==0){suppress.current=false;e.preventDefault();e.stopPropagation();}},
  onContextMenu:(e:{preventDefault:()=>void})=>e.preventDefault(),
 };
}

export function StudentCycleCard({student,date,ledger,selected,ready,color,focusedId,index,view,onFact,onMenu,onOpen,onAssign,onState,onCancel,onHistory,onSelect,onHomework,homeworkLabel,onScope}:{student:Student;date:string;events:ClassEvent[];ledger:ClassEvent[];selected:boolean;ready:boolean;color:string[];focusedId?:string;index:number;view?:ClassroomView;onFact?:(field:keyof ClassStatus)=>void;onMenu:(id?:string)=>void;onOpen:()=>void;onAssign:()=>void;onState:(event:ClassEvent,state:Task['state'])=>void;onCancel:(event:ClassEvent,value:boolean)=>Promise<void>;onHistory:()=>void;onSelect:(event:ClassEvent)=>void;onHomework?:()=>void;homeworkLabel?:string;onScope?:(event:ClassEvent)=>void}){
 const v=view||classroomView(student.id,date,{ledger,sessions:[],events:[],captures:[],connected:false},focusedId);
 const current=v.current?.event,t=v.current?.task||null,status=v.status,needs=v.followups.map(x=>x.event);
 const hold=useContextHold(()=>onMenu(current?.entity_id),student.id+':'+date+':'+(current?.id||''));
 const state=t?havrutaState(t):'assigned';
 const next:Task['state']|null=!t||t.cancelled||state==='done'||state==='skipped'?null:state==='assigned'||state==='pending'?'working':state==='working'&&t.lane==='student'?'student_done':'done';
 const label=t?.havruta?(next==='working'?'협동 시작':next==='student_done'?'설명 요청':next==='done'?'설명 확인·통과':'활동 배정'):next==='working'?'시작 표시':next==='student_done'?'학생 마침':next==='done'?'강사 확인':'활동 배정';
 const style={'--student-accent':color[0],'--student-tint':color[1]} as CSSProperties;
 return <article id={'classroom-student-'+student.id} tabIndex={-1} className={'a-student '+(selected?'is-selected ':'')+(status.departedAt?'has-departed':'')} style={style} data-student-id={student.id}>
  <header className="a-personline"><span className="a-avatar" aria-hidden="true">{index+1}</span><button className="a-person" id={'field-student-'+student.id} onClick={onOpen} {...hold}><strong>{student.name}</strong><small>{classPart(student.id,date,[student])} · {student.books.join(' · ')||'교재 미입력'}</small></button><span className={'a-state '+(status.departedAt?'complete':needs.length?'attention':'')}>{status.departedAt?'귀가 · 후정리':t&&!t.cancelled?t.havruta?havrutaLabel(t):t.state==='student_done'?'학생 마침':taskLabels[t.state]:v.known?'배정 전':'기록 확인 중'}</span><button className="a-more" aria-label={student.name+' 추가 동작'} onClick={()=>onMenu(current?.entity_id)} disabled={!ready}><MoreHorizontal size={21}/></button></header>
  {current&&t?<SwipeDeleteCard key={current.entity_id} className="a-activity-swipe" label={student.name+' '+displayTitle(t.title)} revision={current.id+current.body} deleted={!!t.cancelled} disabled={!ready} onDelete={()=>onCancel(current,true)} onRestore={()=>onCancel(current,false)} onActivate={onAssign} activationLabel={student.name+' 활동 배정 · '+displayTitle(t.title)} heading={<span className="a-workline"><span className="a-dot"/><span className="a-activity">{displayTitle(t.title)}</span><ActivityClock timing={t.timing}/></span>}><div className="a-activity-context">{onScope?<button className="a-scope-link" aria-label={student.name+' '+displayTitle(t.title)+' 배정 범위 수정'} disabled={!ready||!!t.cancelled} onClick={()=>onScope(current)}><BookOpen size={16}/><span><small>{t.lane==='teacher'?'강사 진행·확인':'학생 활동'} · 배정 범위</small>{t.range||'교재·단원·쪽수 선택'}</span><ChevronRight size={15}/></button>:<><span>{t.lane==='teacher'?'강사 진행·확인':'학생 활동'}</span>{t.range&&<span>{t.range}</span>}</>}</div></SwipeDeleteCard>:<button className="a-unassigned" onClick={onAssign} disabled={!ready}><Plus size={17}/>현재 할 일 배정</button>}
  <div className="a-card-actions"><button className="a-primary" disabled={!ready||!!status.departedAt} onClick={()=>current&&next?onState(current,next):onAssign()}>{status.departedAt?'귀가 기록됨':label}</button><button disabled={!ready||!current||!!t?.cancelled} onClick={()=>current&&onState(current,'check')}>다시 보기</button>{onFact?<div className="a-fact-actions"><button aria-label={student.name+' 숙제 안내 사실'} aria-pressed={!!status.instructionAt} disabled={!ready} onClick={()=>onFact('instructionAt')}>{status.instructionAt?<Check size={13}/>:null}안내</button><button aria-label={student.name+' 귀가 사실'} aria-pressed={!!status.departedAt} disabled={!ready} onClick={()=>onFact('departedAt')}>{status.departedAt?<Check size={13}/>:null}귀가</button></div>:<button onClick={onHistory}><History size={15}/><span>이력</span></button>}</div>
  <div className="a-followups">{needs.filter(e=>e.entity_id!==current?.entity_id).slice(0,2).map(e=><button key={e.entity_id} onClick={()=>onSelect(e)}><span className="a-dot"/>{displayTitle(eventTask(e).title)}<ChevronRight size={13}/></button>)}{needs.filter(e=>e.entity_id!==current?.entity_id).length>2&&<button onClick={()=>onMenu()} className="a-followup-count">확인할 일 더 보기</button>}{v.openWork.length>1&&<button onClick={()=>onMenu()}>함께 진행할 활동 {v.openWork.length}</button>}</div>
  <footer className="a-student-foot"><span className="subject-retention" data-save-state={v.activityRetention}>{retentionLabels[v.activityRetention]}</span>{onHomework&&<button className="a-homework-link" disabled={!ready} aria-label={student.name+' 숙제 배정'} onClick={onHomework}><BookOpen size={15}/>{homeworkLabel||'다음 숙제'}<ChevronRight size={14}/></button>}</footer>
 </article>;
}

export function ClassroomBoard(p:Props){
 const [menu,setMenu]=useState<Menu|null>(null),[focused,setFocused]=useState<Record<string,string>>({}),[undo,setUndo]=useState<Undo|null>(null),[notice,setNotice]=useState(''),[history,setHistory]=useState<ClassEvent[]|null>(null),[historyError,setHistoryError]=useState(''),[busy,setBusy]=useState<string[]>([]);
 const latest=useRef(p),busyRef=useRef(new Set<string>()),historyGeneration=useRef(0);
 useLayoutEffect(()=>{latest.current=p;},[p]);
 useEffect(()=>()=>{historyGeneration.current++;},[]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>{setNotice('');setUndo(null);},4500);return()=>clearTimeout(timer);},[notice,undo?.afterId]);
 const own=(sid:string)=>p.ledger.filter(e=>e.student_id===sid&&e.kind==='activity'&&eventTask(e).workDate===p.date);
 function open(studentId:string,mode:Menu['mode'],entityId?:string){setMenu({studentId,mode,entityId});setHistory(null);setHistoryError('');}
 async function write(studentId:string,kind:string,id:string,body:Task|ClassStatus,before:Task|ClassStatus,originDate:string,baseId:string,label:string,keepOpen=false){
  if(busyRef.current.has(studentId))return;
  busyRef.current.add(studentId);setBusy([...busyRef.current]);
  try{const saved=await p.save(studentId,kind,id,body,originDate,baseId,'event');setUndo({studentId,kind,entityId:id,date:originDate,afterId:saved.id,before,label});setNotice((p.students.find(s=>s.id===studentId)?.name||studentId)+' · '+label+' · 기기 보관');if(!keepOpen)setMenu(current=>current===menu?null:current);return saved;}
  catch(e){p.fail(e);return undefined;}
  finally{busyRef.current.delete(studentId);setBusy([...busyRef.current]);}
 }
 async function change(event:ClassEvent,patch:Partial<Task>,label:string){
  const current=latest.current.ledger.find(e=>e.entity_id===event.entity_id);
  if(current?.id!==event.id){p.fail(new Error('다른 수정이 있습니다. 현재 활동을 대조해 주세요.'));return;}
  if(patch.cancelled!==undefined)setFocused(v=>({...v,[event.student_id]:event.entity_id}));
  const before=eventTask(event),after={...before,...patch};
  await write(event.student_id,'activity',event.entity_id,after,before,event.class_date,event.id,label);
 }
 async function assign(studentId:string,title:string){
  const id=crypto.randomUUID(),body={...task(title,p.date),timing:assignedTiming()};
  const result=await write(studentId,'activity',id,body,{...body,cancelled:true},p.date,'','활동 배정 · '+displayTitle(title));
  if(result)setFocused(v=>({...v,[studentId]:id}));
 }
 async function state(event:ClassEvent,next:Task['state']){const t=eventTask(event);if(t.havruta&&t.cancelled)return;await change(event,havrutaStatePatch(t,next),t.havruta?(next==='done'?'교사 통과':havrutaLabel({...t,state:next})):taskLabels[next]);}
 async function fact(studentId:string,field:keyof ClassStatus){
  const id=entity('class_status',studentId,p.date),before=classStatus(latest.current.ledger,studentId,p.date),row=latest.current.ledger.find(e=>e.entity_id===id);
  const after={...before,[field]:before[field]?'':new Date().toISOString()};
  await write(studentId,'class_status',id,after,before,p.date,row?.id||'',(field==='departedAt'?'귀가':'숙제 안내')+(after[field]?' 사실 기록':' 표시 취소'));
 }
 async function restore(){
  if(!undo)return;const current=latest.current.ledger.find(e=>e.entity_id===undo.entityId);
  if(current?.id!==undo.afterId){setNotice('다른 수정 이후에는 덮어쓰지 않습니다. 이력에서 대조하세요.');setUndo(null);return;}
  const saved=await write(undo.studentId,undo.kind,undo.entityId,undo.before,JSON.parse(current.body),undo.date,current.id,undo.label+' 되돌림');
  if(saved)setUndo(null);
 }
 async function showHistory(studentId:string){
  open(studentId,'history');const generation=++historyGeneration.current;
  const ids=[...new Set(latest.current.ledger.filter(e=>e.student_id===studentId&&(e.class_date===p.date||e.kind==='activity'&&eventTask(e).workDate===p.date)).map(e=>e.entity_id))];
  try{const groups=await Promise.all(ids.map(async id=>{const r=await fetch('/api/classroom?entity='+encodeURIComponent(id),{cache:'no-store'});if(!r.ok)throw new Error('연결 후 전체 이력을 다시 확인해 주세요. 기기 보관 내용은 유지됩니다.');return (await r.json() as {ledger:ClassEvent[]}).ledger;}));if(generation===historyGeneration.current)setHistory(groups.flat().sort((a,b)=>(b.recorded_at_client||b.created_at).localeCompare(a.recorded_at_client||a.created_at)));}
  catch(e){if(generation===historyGeneration.current)setHistoryError(e instanceof Error?e.message:'이력을 불러오지 못했습니다.');}
 }
 const student=menu?p.students.find(s=>s.id===menu.studentId):undefined;
 async function retainScope(studentId:string,activityId:string,draft:ActivityScopeDraft|null){const id=entity('plan',studentId,p.date),row=latest.current.ledger.find(e=>e.entity_id===id);await p.save(studentId,'plan',id,mergeActivityScopeDraft(values(row,{titles:activityChoices()}),activityId,draft),p.date,row?.id||'','draft');}
 const activeEvent=menu?.entityId?p.ledger.find(e=>e.entity_id===menu.entityId&&e.student_id===menu.studentId):undefined;
 const activeTask=activeEvent?eventTask(activeEvent):null;
 const selectedStatus=menu?classStatus(p.ledger,menu.studentId,p.date):null;
 const views=p.students.map(s=>classroomView(s.id,p.date,p.data,focused[s.id]));
 const observed=p.data.classroomLoaded!==false;
 function jumpToStudent(studentId:string){
  const target=document.getElementById('classroom-student-'+studentId);
  if(!target)return;
  target.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  target.focus({preventScroll:true});
 }
 function jumpCue(view:ClassroomView){
  if(!view.known)return '기록 확인 중';
  if(view.status.departedAt)return '귀가 기록';
  if(view.openWork.some(a=>a.task.state==='working'))return '활동 진행';
  return view.current&&!view.current.task.cancelled?taskLabels[view.current.task.state]:'배정 전';
 }
 function homeworkLabel(s:Student){const c=values(p.ledger.find(e=>e.entity_id===entity('closeout',s.id,p.date)),blankCloseout);if(c.noHomework)return '숙제 없음';const due=c.due||nextHomeworkDue(s,p.date,p.data.sheet?.snapshot).date;return (due?due.slice(5)+'까지 · ':'')+(c.homework?'숙제 수정':'숙제 배정');}
 return <div className="a-board-content">
  {p.view==='class'?<>
   <HavrutaPanel key={p.box?.owner||'loading'} students={p.students} date={p.date} data={p.data} ready={p.ready} box={p.box} save={p.save} onOpen={id=>p.onOpen(id,'class')} fail={p.fail}/>
   <div className="a-class-pulse" aria-label="현재 수업의 기록 요약"><span><strong>{p.students.length}</strong>명 예정</span><span><strong>{observed?views.flatMap(v=>v.openWork).filter(v=>v.task.state==='working').length:'—'}</strong>진행 활동</span><span className="pulse-attention"><strong>{observed?views.reduce((n,v)=>n+v.followups.length,0):'—'}</strong>확인할 일</span><span><strong>{observed?views.filter(v=>v.status.departedAt).length:'—'}</strong>귀가 기록</span></div>
   {p.students.length>=6&&<nav className="a-student-jump" aria-label="학생 카드로 이동"><div className="a-student-jump-list">{p.students.map((s,i)=>{const v=views[i],cue=jumpCue(v),needs=v.known?v.followups.length:0;return <button key={s.id} type="button" className={'a-student-jump-item '+(needs?'has-needs ':v.status.departedAt?'has-departed ':'')+(p.selected===s.id?'is-selected':'')} aria-label={`${s.name} 학생 카드로 이동 · ${cue}${needs?' · 확인할 일 '+needs+'건':''}`} aria-controls={'classroom-student-'+s.id} onClick={()=>jumpToStudent(s.id)}><strong>{s.name}</strong><small><span>{cue}</span>{needs>0&&<span className="a-student-jump-needs">확인 {needs}</span>}</small></button>;})}</div></nav>}
   <div className="a-overview-line"><span>학생 활동과 강사가 볼 일을 함께</span><span>예정은 출석 기록과 별개</span></div>
   <div className="a-board">{p.students.map((s,i)=><StudentCycleCard key={s.id} student={s} index={i} date={p.date} ledger={p.ledger} events={own(s.id)} view={views[i]} color={palettes[i%palettes.length]} focusedId={focused[s.id]} selected={p.selected===s.id} ready={p.ready&&!busy.includes(s.id)} onOpen={()=>p.onOpen(s.id,'class')} onAssign={()=>open(s.id,'assign')} onScope={e=>open(s.id,'scope',e.entity_id)} onHomework={()=>open(s.id,'homework')} homeworkLabel={homeworkLabel(s)} onMenu={id=>open(s.id,id?'actions':'activities',id)} onState={(e,next)=>void state(e,next)} onFact={field=>void fact(s.id,field)} onCancel={async(e,value)=>{await change(e,{cancelled:value},value?'활동 취소':'활동 복원');}} onHistory={()=>void showHistory(s.id)} onSelect={e=>{setFocused(v=>({...v,[s.id]:e.entity_id}));open(s.id,'actions',e.entity_id);}}/>)}</div>
   <p className="a-gesture-help">활동을 밀어 취소·복원 · 이름 길게 누르기와 ⋯는 같은 메뉴 · 안내·귀가는 사실만 기록</p>
  </>:<>
   <section className="a-after-intro"><span className="a-eyebrow">AFTER CLASS</span><h2>오늘의 기록을 이어서</h2><p>활동과 원음을 대조하고, 진도·숙제를 확정한 뒤 원본 반영까지 확인합니다.</p></section>
   <div className="a-after-grid">{p.students.map((s,i)=>{const v=views[i];return <section className="a-after-card" key={s.id}><header><h3>{s.name}</h3><span className={'a-state '+(v.confirmation==='confirmed'?'complete':v.confirmation==='stale'?'attention':'')}>{v.confirmationLabel}</span></header><p>{v.status.departedAt?'귀가 기록 있음':'귀가 미표시'} · {v.status.instructionAt?'숙제 안내함':'안내 미표시'}</p><div className="a-after-evidence"><span><BookOpen size={15}/>활동 {v.known?v.activities.filter(a=>!a.task.cancelled).length:'—'}</span><span><AudioLines size={15}/>대화 {v.known?v.sources.length:'—'}</span></div>{v.record&&<div className="a-after-brief"><strong>진도</strong><p>{v.closeout.progress||'검토하며 보완하세요.'}</p><strong>숙제</strong><p>{v.closeout.noHomework?'없음으로 확인':v.closeout.homework||'범위·기한 확인 전'}{v.closeout.due&&!v.closeout.noHomework?' · '+v.closeout.due:''}</p></div>}<RecordProgress view={v} onTracker={p.onTracker?()=>p.onTracker!(s.id):undefined}/><div className="a-card-actions"><button onClick={()=>p.onAudio(s.id)} disabled={!p.ready}>음성 메모 연결</button><button className="a-primary" onClick={()=>p.onOpen(s.id,'review')}>근거 검토<ArrowUpRight size={15}/></button><button aria-label={s.name+' 수업 이력'} onClick={()=>void showHistory(s.id)}><History size={16}/></button></div></section>;})}</div>
  </>}
  {!p.students.length&&<p className="a-empty">예정 학생이 없습니다. 전체 명단이나 수업일을 확인하세요. 출석·활동은 자동 생성하지 않습니다.</p>}
  {notice&&<div className="a-toast" role="status"><span>{notice}</span>{undo&&<button onClick={()=>void restore()}><Undo2 size={16}/>되돌리기</button>}<button aria-label="안내 닫기" onClick={()=>{setNotice('');setUndo(null);}}>×</button></div>}
  <Dialog open={!!menu} onOpenChange={v=>{if(!v){setMenu(null);historyGeneration.current++;}}}><DialogContent className="a-action-sheet translate-x-0 translate-y-0 sm:translate-x-[-50%] sm:translate-y-[-50%]"><DialogHeader><DialogTitle>{student?.name} · {menu?.mode==='scope'?'배정 범위 수정':menu?.mode==='homework'?'숙제 배정':menu?.mode==='assign'?'활동 배정':menu?.mode==='history'?'수업 이력':menu?.mode==='revisit'?'다시 볼 시점':'수업 동작'}</DialogTitle><DialogDescription>{menu?.mode==='scope'?'기존 활동에 교재·단원·쪽수 연결 · 새 활동이나 완료를 만들지 않습니다.':menu?.mode==='homework'?'교재·단원·쪽수로 선택 · 다음 등록 수업일을 기본으로':menu?.mode==='history'?'입력한 사건과 수정 이력을 따로 보관합니다.':'수업 중 사실만 표시 · 자세한 내용은 수업 후'}</DialogDescription></DialogHeader>
  {menu&&student&&<>
    {menu.mode==='scope'&&activeEvent&&<ActivityScopeEditor key={activeEvent.entity_id} event={activeEvent} studentId={student.id} date={p.date} catalog={catalogFromSnapshot(p.data.sheet?.snapshot)} draft={values(p.ledger.find(e=>e.entity_id===entity('plan',student.id,p.date)),{activityScopeDrafts:[] as ActivityScopeDraft[]}).activityScopeDrafts.find(d=>d.activityId===activeEvent.entity_id)} retain={d=>retainScope(student.id,activeEvent.entity_id,d)} onApply={async(d,c)=>{const current=latest.current.ledger.find(e=>e.entity_id===d.activityId),next=applyActivityScope(current,d,student.id,p.date,c);const saved=await write(student.id,'activity',d.activityId,next,eventTask(current!),current!.class_date,current!.id,'배정 범위 수정',true);if(!saved)throw new Error('범위 보관 결과를 확인하지 못했습니다. 선택은 유지됩니다.');}} onDone={()=>setMenu(null)} fail={p.fail}/>}
    {menu.mode==='homework'&&<HomeworkPanel key={student.id+':'+p.date} student={student} date={p.date} ledger={p.ledger} snapshot={p.data.sheet?.snapshot} save={async(kind,id,data,date,baseId,mode)=>{await p.save(student.id,kind,id,data,date,baseId,mode);}} fail={p.fail} onDone={()=>setMenu(null)}/>}
    {menu.mode==='assign'&&<><CurriculumAssignment key={student.id+':'+p.date} studentId={student.id} date={p.date} initialCatalog={catalogFromSnapshot(p.data.sheet?.snapshot)} draft={values(p.ledger.find(e=>e.entity_id===entity('plan',student.id,p.date)),{scopeDraft:undefined as AssignmentDraft|undefined}).scopeDraft} retain={async draft=>{const id=entity('plan',student.id,p.date);await p.save(student.id,'plan',id,{...values(p.ledger.find(e=>e.entity_id===id),{titles:activityChoices()}),scopeDraft:draft},p.date,undefined,'draft');}} assign={async(title,scope,id)=>{await p.save(student.id,'activity',id,{...task(title,p.date),scope,range:scopeText(scope),timing:assignedTiming()},p.date,'','event');setFocused(v=>({...v,[student.id]:id}));}} fail={p.fail}/><p className="hint">범위 없이 빠르게 배정 · 나중에 보완 가능</p><div className="a-menu-grid">{activityChoices(values(p.ledger.find(e=>e.entity_id===entity('plan',student.id,p.date)),{titles:activityChoices()}).titles).map(title=><button key={title} disabled={busy.includes(student.id)} onClick={()=>void assign(student.id,title)}><Plus size={19}/><span>{displayTitle(title)}</span></button>)}</div></>}
    {menu.mode==='actions'&&<><div className="a-menu-grid"><button onClick={()=>open(student.id,'assign')}><Plus size={19}/><span>활동 배정<small>기존 활동은 자동 삭제하지 않음</small></span></button>{activeEvent&&activeTask&&<><button disabled={busy.includes(student.id)||!!activeTask.cancelled} onClick={()=>open(student.id,'scope',activeEvent.entity_id)}><BookOpen size={19}/><span>교재·범위 수정<small>기존 활동에 범위만 연결</small></span></button><button disabled={busy.includes(student.id)} onClick={()=>void state(activeEvent,'student_done')}><Check size={19}/><span>학생 마침<small>강사 확인·숙달과 별개</small></span></button><button disabled={busy.includes(student.id)} onClick={()=>void state(activeEvent,'done')}><Check size={19}/><span>{activeTask.havruta?'설명 확인·이 학생 통과':'강사 확인 마침'}<small>다른 학생·숙달을 자동 판정하지 않음</small></span></button><button onClick={()=>void change(activeEvent,{timing:scheduleVisit(activeTask.timing,null,true)},'다녀왔음')}><ChevronRight size={19}/><span>다녀왔음<small>배정 시각 유지</small></span></button><button onClick={()=>open(student.id,'revisit',activeEvent.entity_id)}><Clock size={19}/><span>다시 볼 시점<small>필요한 경우에만 지정</small></span></button><button onClick={()=>void state(activeEvent,'check')}><History size={19}/><span>확인할 일 표시</span></button></>}<button onClick={()=>void fact(student.id,'instructionAt')}><ArrowUpRight size={19}/><span>{selectedStatus?.instructionAt?'숙제 안내 표시 취소':'숙제 안내함'}<small>상세 숙제 확정은 별도</small></span></button><button onClick={()=>void fact(student.id,'departedAt')}><ChevronRight size={19}/><span>{selectedStatus?.departedAt?'귀가 표시 취소':'귀가 사실 기록'}<small>글 입력·마감 확정 불필요</small></span></button><button onClick={()=>void showHistory(student.id)}><History size={19}/><span>수업 이력</span></button><button onClick={()=>open(student.id,'activities')}><BookOpen size={19}/><span>전체 활동·수정</span></button></div>{activeEvent&&activeTask&&<div className="a-state-options">{(['assigned','working','student_done','check','done','pending','skipped'] as const).map(value=><button key={value} aria-pressed={havrutaState(activeTask)===value} onClick={()=>void state(activeEvent,value)}>{activeTask.havruta?(value==='done'?'교사 통과':havrutaLabel({...activeTask,state:value})):taskLabels[value]}</button>)}<button onClick={()=>void change(activeEvent,{cancelled:!activeTask.cancelled},activeTask.cancelled?'활동 복원':'활동 취소')}>{activeTask.cancelled?'활동 복원':'활동 취소'}</button></div>}</>}
    {menu.mode==='activities'&&<><div className="a-activity-list">{own(student.id).map(e=>{const t=eventTask(e);return <button key={e.entity_id} onClick={()=>{setFocused(v=>({...v,[student.id]:e.entity_id}));open(student.id,'actions',e.entity_id);}}><span><strong>{displayTitle(t.title)}</strong><small>{t.cancelled?'취소됨 · 복원 가능':t.havruta?havrutaLabel(t):taskLabels[t.state]} · {t.lane==='teacher'?'강사':'학생'}{t.range?' · '+t.range:''}</small></span><ChevronRight size={16}/></button>;})}</div><div className="a-menu-grid"><button onClick={()=>open(student.id,'assign')}><Plus size={19}/>활동 배정</button><button onClick={()=>void fact(student.id,'instructionAt')}>{selectedStatus?.instructionAt?'숙제 안내 표시 취소':'숙제 안내함'}</button><button onClick={()=>void fact(student.id,'departedAt')}>{selectedStatus?.departedAt?'귀가 표시 취소':'귀가 사실 기록'}</button><button onClick={()=>{setMenu(null);p.onOpen(student.id,'class');}}>범위·이전 미해결 상세</button></div></>}
    {menu.mode==='revisit'&&activeEvent&&activeTask&&<div className="a-menu-grid">{[3,5,10,15,30,null].map(minutes=><button key={String(minutes)} onClick={()=>void change(activeEvent,{timing:scheduleVisit(activeTask.timing,minutes,false)},minutes===null?'재방문 시점 해제':minutes+'분 뒤 다시 보기')}><Clock size={18}/>{minutes===null?'시점 해제':minutes+'분 뒤'}</button>)}</div>}
    {menu.mode==='history'&&<div className="a-history">{historyError?<p role="alert">{historyError}</p>:history===null?<p>서버 이력 확인 중 · 미전송 기록은 상단 저장 상태에서 확인하세요.</p>:history.length?history.map(e=><article key={e.id}><time>{time(e.recorded_at_client||e.created_at)}</time><div><strong>{headline(e)}</strong><small>원수업 {e.class_date} · {e.recorded_at_client?'기기 입력 시각':'서버 보관 시각'}</small><details><summary>기록 근거</summary><p>요청 {e.id}<br/>이전 수정본 {e.base_revision_id||'첫 기록'}</p><pre>{JSON.stringify(JSON.parse(e.body),null,2)}</pre></details></div></article>):<p>서버에 보관된 사건이 없습니다. 미전송 여부는 저장 상태를 확인하세요.</p>}</div>}
   </>}
  </DialogContent></Dialog>
 </div>;
}

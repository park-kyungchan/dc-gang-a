import {blankCloseout,classStatus,completeCloseout,entity,isOpen,isTest,task,values,type ClassEvent,type Closeout,type Task} from './classroom';
import {closeoutCurrent,closeoutEvidenceBasis} from './closeout-review';
import type {NotebookData} from './projection';
import type {LocalItem} from './outbox';
import type {SheetMapping,SheetReceipt,SheetSnapshot} from './sheet-bridge';
import {havrutaState} from './havruta';

/** Read models for real classroom decisions, not another authoritative store.
 * Sources: classroom-product-direction + autonomous-classroom-tdg U3.
 * A viewed subject, action revision, confirmation and external receipt differ.
 */
export type SheetObservation={date:string;configured:boolean;connected:boolean;rehearsalId?:string;mappings:SheetMapping[];receipts:SheetReceipt[];baselines:{student_id:string;remote_revision:string}[];snapshot?:SheetSnapshot;observedAt?:string;lastError?:string};
export type Retention='empty'|'pending'|'blocked'|'server'|'unknown';
export type Confirmation='unknown'|'missing'|'draft'|'stale'|'confirmed';
export type Reflection='unknown'|'unconfirmed'|'unconnected'|'pending'|'conflict'|'reflected';
export const confirmationLabels:Record<Confirmation,string>={unknown:'기록 확인 중',missing:'검토 전',draft:'작성 중 · 확정 전',stale:'근거 변경 · 재검토',confirmed:'진도·숙제 확정함'};
export const retentionLabels:Record<Retention,string>={empty:'기록 전',pending:'기기 보관 · 전송 대기',blocked:'기기 보관 · 확인 필요',server:'서버 보관',unknown:'보관 상태 확인 필요'};
export const reflectionLabels:Record<Reflection,string>={unknown:'원본 상태 확인 전',unconfirmed:'검토·확정 후 반영',unconnected:'원본 연결 확인 필요',pending:'원본 반영 대기',conflict:'원본 수정 대조 필요',reflected:'마지막 조회에 반영 확인'};

export function retentionOf(record:ClassEvent|undefined,items:LocalItem[]=[]):Retention {
 if(!record)return 'empty';
 const item=items.find(i=>i.url==='/api/classroom'&&i.payload?.id===record.id&&i.payload.studentId===record.student_id&&i.payload.entityId===record.entity_id);
 if(item&&['job','draft'].includes(item.type))return item.error?'blocked':'pending';
 if(item?.type==='receipt')return 'server';
 return record.local_projection?'unknown':'server';
}

export function reflectionOf(studentId:string,date:string,record:ClassEvent|undefined,confirmation:Confirmation,sheet?:SheetObservation):Reflection {
 if(confirmation!=='confirmed'||!record)return 'unconfirmed';
 if(!sheet||sheet.date!==date)return 'unknown';
 const mapping=sheet.mappings.find(m=>m.studentId===studentId);
 if(!sheet.configured||!sheet.connected||!mapping||mapping.active===false)return 'unconnected';
 if(sheet.snapshot?.date!==date)return 'unknown';
 const remote=sheet.snapshot.tracker.students.find(s=>s.studentId===studentId);
 if(!remote)return 'unknown';
 const receipts=sheet.receipts.filter(r=>r.student_id===studentId&&r.class_date===date),last=receipts.at(-1);
 const latest=sheet.rehearsalId?remote.latestTestReview:remote.latestReview;
 const local=JSON.parse(record.body) as Closeout&{resolution?:{choice:string;comparedRemoteId:string;comparedTrackerRevision:string}};
 const approved=local.resolution?.choice==='site'&&local.resolution.comparedRemoteId===(latest?.id||'')&&local.resolution.comparedTrackerRevision===remote.revision;
 const baseline=sheet.baselines.find(b=>b.student_id===studentId)?.remote_revision??mapping.trackerRevision??'';
 if(!approved&&((latest?.id||'')!==(last?.remote_id||'')||remote.revision!==baseline))return 'conflict';
 const receipt=receipts.find(r=>r.entry_id===record.id);
 // A receipt is historical evidence; it cannot certify a different latest row.
 if(receipt&&latest?.id===receipt.remote_id&&latest.data.sourceId===record.id)return 'reflected';
 return sheet.lastError?'unknown':'pending';
}

export function classroomView(studentId:string,date:string,data:NotebookData,focusedId?:string){
 const activities=data.ledger.filter(e=>e.student_id===studentId&&e.kind==='activity').map(e=>({event:{...e},task:values(e,task('',e.class_date))})).filter(v=>v.task.workDate===date);
 const active=activities.filter(v=>!v.task.cancelled);
 const current=activities.find(v=>v.event.entity_id===focusedId&&(v.task.lane==='student'||v.task.cancelled))||[...active].reverse().find(v=>v.task.lane==='student'&&isOpen(v.task))||active.at(-1)||activities.at(-1);
 const followups=active.filter(v=>havrutaState(v.task)==='check'||havrutaState(v.task)==='student_done'||!!v.task.unresolved.trim()||v.task.lane==='teacher'&&isOpen(v.task));
 const openWork=active.filter(v=>v.task.lane==='student'&&isOpen(v.task));
 const row=data.ledger.find(e=>e.entity_id===entity('closeout',studentId,date)&&e.student_id===studentId&&e.class_date===date&&e.kind==='closeout');
 const record=row?{...row}:undefined,closeout=values(record,blankCloseout),basis=closeoutEvidenceBasis(studentId,date,data);
 const known=data.classroomLoaded!==false;
 const confirmation:Confirmation=!known?'unknown':!record?'missing':!closeout.confirmed?'draft':closeoutCurrent(closeout,basis)&&completeCloseout(closeout)?'confirmed':'stale';
 const sources=data.sessions.filter(s=>s.student_id===studentId&&s.class_date===date&&!isTest(s)).map(s=>({...s}));
 const local=data.localItems||[];
 const subjectPending=local.filter(i=>['job','draft'].includes(i.type)&&i.url==='/api/classroom'&&i.payload?.studentId===studentId&&(i.payload.date===date||(i.payload.data as Partial<Task>|undefined)?.workDate===date));
 const statusRecord=data.ledger.find(e=>e.student_id===studentId&&e.class_date===date&&e.entity_id===entity('class_status',studentId,date));
 const activityRetention:Retention=subjectPending.some(i=>i.error)?'blocked':subjectPending.length?'pending':!known&&!current&&!statusRecord?'unknown':retentionOf(current?.event||statusRecord,local);
 return {studentId,date,known,activities,current,followups,openWork,sources,status:classStatus(data.ledger,studentId,date),record,closeout,confirmation,confirmationLabel:confirmationLabels[confirmation],retention:!known&&!record?'unknown' as Retention:retentionOf(record,local),activityRetention,reflection:reflectionOf(studentId,date,record,confirmation,data.sheet),originalObservedAt:data.sheet?.date===date?data.sheet.observedAt:undefined};
}
export type ClassroomView=ReturnType<typeof classroomView>;

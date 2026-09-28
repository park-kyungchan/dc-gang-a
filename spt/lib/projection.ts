import type {Session,Entry,Capture,Student} from './notebook';
import type {ClassEvent} from './classroom';
import type {LocalItem} from './outbox';
import type {SheetObservation} from './classroom-view';
export type NotebookData={sessions:Session[];events:Entry[];captures:Capture[];ledger:ClassEvent[];connected:boolean;classroomLoaded?:boolean;rehearsalId?:string;connectionSource?:'hermes'|'app'|null;captureMode?:'browser'|'voice_memos';roster?:Student[];rosterRevision?:string;rosterSource?:'initial'|'sheet'|'synthetic';sheet?:SheetObservation;localItems?:LocalItem[]};
export const emptyData:NotebookData={sessions:[],events:[],captures:[],ledger:[],connected:false,classroomLoaded:false};
export function projectData(base:NotebookData,items:LocalItem[],date:string):NotebookData{
 const data={...base,sessions:[...base.sessions],events:[...base.events],captures:[...base.captures],ledger:[...base.ledger]};
 for(const item of items){const p=item.payload;if(!p||!['job','draft','receipt'].includes(item.type))continue;const created=p.createdAt||new Date(Math.floor(item.order/1000)).toISOString();
  if(item.url==='/api/classroom'){const e:ClassEvent={id:p.id,entity_id:p.entityId!,student_id:p.studentId!,class_date:p.date!,kind:p.kind!,body:JSON.stringify(p.data),created_at:created,recorded_at_client:p.recordedAtClient??null,base_revision_id:p.baseId??null,local_projection:true};data.ledger=data.ledger.filter(x=>x.entity_id!==e.entity_id).concat(e);}
  if(item.url==='/api/notebook'&&p.action==='create'&&p.date===date&&!data.sessions.some(s=>s.id===p.id))data.sessions.push({id:p.id,student_id:p.studentId!,class_date:p.date,title:p.title,created_at:created,purpose:p.purpose,ended_at:null});
  if(item.url==='/api/notebook'&&p.action==='end')data.sessions=data.sessions.map(s=>s.id===p.id?{...s,ended_at:created}:s);
  if(item.url==='/api/notebook'&&p.action==='entry'&&data.sessions.some(s=>s.id===p.sessionId)&&!data.events.some(e=>e.id===p.id))data.events.push({id:p.id,session_id:p.sessionId!,kind:p.kind!,body:JSON.stringify(p.data),capture_id:p.captureId||'',created_at:created,recorded_at_client:p.recordedAtClient??null,base_revision_id:p.baseId??null,local_projection:true});
  if(item.url==='/api/capture'&&p.action==='start'&&data.sessions.some(s=>s.id===p.sessionId)&&!data.captures.some(c=>c.id===p.id))data.captures.push({id:p.id,session_id:p.sessionId!,state:'recording',created_at:created,ended_at:null,samples:0,chunks:0});
  if(item.url==='/api/capture'&&p.action==='end')data.captures=data.captures.map(c=>c.id===p.id?{...c,state:p.interrupted?'interrupted':'ended',ended_at:created}:c);
 }
 return data;
}

import {readRoster} from '@/lib/roster-server';
import {clientRecordedAt} from '@/lib/provenance';
import {owner,db,body,result,failure,ApiError} from '@/lib/server';
import {uuid,validDate,text} from '@/lib/notebook';
import {validateClass} from '@/lib/classroom';
import type {Closeout,Task} from '@/lib/classroom';
import {assertCloseoutReview} from '@/lib/closeout-review';
import {loadCloseoutEvidence} from '@/lib/closeout-analysis';
import {assertScopeCurrent,catalogFromSnapshot} from '@/lib/curriculum';
import {assertHomeworkCurrent} from '@/lib/homework';
import {assertHavrutaTransition,havrutaManifest,havrutaState} from '@/lib/havruta';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await owner();const target=new URL(request.url).searchParams.get('entity');const rows=target?await db().prepare('SELECT id,entity_id,student_id,class_date,kind,body,created_at,recorded_at_client,base_revision_id,schema_version FROM spt_class_events WHERE owner=? AND entity_id=? ORDER BY rowid').bind(user,target).all():await db().prepare('SELECT e.id,e.entity_id,e.student_id,e.class_date,e.kind,e.body,e.created_at,e.recorded_at_client,e.base_revision_id,e.schema_version FROM spt_class_events e WHERE e.owner=? AND NOT EXISTS (SELECT 1 FROM spt_class_events n WHERE n.owner=e.owner AND n.entity_id=e.entity_id AND n.rowid>e.rowid) ORDER BY e.rowid').bind(user).all();return result({ledger:rows.results});}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request),p=await body(request,180000);if(!uuid(p.id)||!(await readRoster(user)).roster.some(s=>s.id===p.studentId)||!validDate(p.date))throw new ApiError('학생과 수업일을 확인해 주세요.');const entityId=text(p.entityId,100);if(p.kind==='activity'?!uuid(entityId):entityId!==`${p.kind}:${p.studentId}:${p.date}`)throw new ApiError('활동 대상을 확인해 주세요.');let data:ReturnType<typeof validateClass>;try{data=validateClass(p.kind,p.data,p.date)}catch(e){throw new ApiError(e instanceof Error?e.message:'입력 형식을 확인해 주세요.');}let inputAt:string|null;try{inputAt=clientRecordedAt(p.recordedAtClient);}catch(e){throw new ApiError(e instanceof Error?e.message:'기기 입력 시각을 확인해 주세요.');}const revisionBase=typeof p.baseId==='string'?p.baseId:null,serialized=JSON.stringify(data);
 const old=await db().prepare('SELECT * FROM spt_class_events WHERE id=?').bind(p.id).first();if(old){if(old.owner!==user||old.entity_id!==entityId||old.student_id!==p.studentId||old.class_date!==p.date||old.kind!==p.kind||old.body!==serialized||old.schema_version!==null&&(old.recorded_at_client!==inputAt||old.base_revision_id!==revisionBase))throw new ApiError('같은 저장 요청의 내용이 다릅니다.',409);return result({saved:true,id:p.id});}
 const previous=await db().prepare('SELECT * FROM spt_class_events WHERE owner=? AND entity_id=? ORDER BY rowid DESC LIMIT 1').bind(user,entityId).first();if(previous&&(previous.student_id!==p.studentId||previous.class_date!==p.date||previous.kind!==p.kind))throw new ApiError('원래 학생과 수업일은 바꿀 수 없습니다.',409);
 if(p.kind==='activity'){
  const next=data as Task,prior=previous?JSON.parse(String(previous.body)) as Task:undefined;
  try{
   assertHavrutaTransition(next,prior,p.studentId,entityId,p.date);
   if(next.havruta){
    const roster=(await readRoster(user)).roster;if(next.havruta.members.some(m=>!roster.some(s=>s.id===m.studentId)))throw new Error('하브루타 참여 명단을 확인하세요.');
    const group=await db().prepare("SELECT body FROM spt_class_events WHERE owner=? AND kind='activity' AND json_extract(body,'$.havruta.groupId')=? ORDER BY rowid LIMIT 1").bind(user,next.havruta.groupId).first<{body:string}>();
    if(group&&havrutaManifest(JSON.parse(group.body).havruta)!==havrutaManifest(next.havruta))throw new Error('같은 하브루타의 참여 관계가 다릅니다. 원래 배정을 대조하세요.');
   }
  }catch(error){throw new ApiError(error instanceof Error?error.message:'하브루타 관계를 확인하세요.',409);}
 }
 if(p.kind==='closeout'||p.kind==='closeout_test'){
  const close=data as Closeout, prior=previous?JSON.parse(String(previous.body)) as Closeout:undefined;
  if(close.parentInput&&close.parentInput.studentId!==p.studentId)throw new ApiError('공개 일지의 원래 학생을 유지하세요.',409);
  if(close.homeworkPlan){const observed=await db().prepare('SELECT body FROM spt_sheet_snapshots WHERE owner=? ORDER BY rowid DESC LIMIT 1').bind(user).first<{body:string}>();try{assertHomeworkCurrent(close.homeworkPlan,observed?catalogFromSnapshot(JSON.parse(observed.body)):null,p.studentId,prior?.homeworkPlan);}catch(error){throw new ApiError(error instanceof Error?error.message:'숙제 원본 범위를 대조하세요.',409);}}
  if(close.evidenceBasis!==undefined||close.draftReview||prior?.evidenceBasis!==undefined){
   try{assertCloseoutReview(close,prior,p.studentId,p.date,await loadCloseoutEvidence(user,p.studentId,p.date));}catch(error){throw new ApiError(error instanceof Error?error.message:'초안 근거를 확인해 주세요.',409);}
  }
 }
 if(p.kind==='activity'&&(data as Task).scope&&JSON.stringify((data as Task).scope)!==JSON.stringify(previous?JSON.parse(String(previous.body)).scope:undefined)){const observed=await db().prepare('SELECT body FROM spt_sheet_snapshots WHERE owner=? ORDER BY rowid DESC LIMIT 1').bind(user).first<{body:string}>();try{assertScopeCurrent((data as Task).scope!,observed?catalogFromSnapshot(JSON.parse(observed.body)):null,p.studentId);}catch(error){throw new ApiError(error instanceof Error?error.message:'목차 원본을 대조해 주세요.',409);}}
 if(p.kind==='activity'&&previous){const prior=JSON.parse(String(previous.body)) as Task,activity=data as Task;if(prior.timing&&prior.workDate===activity.workDate&&(!activity.timing||prior.timing.assignedAt!==activity.timing.assignedAt))throw new ApiError('배정 시작 시각은 유지해야 합니다. 최신 활동과 비교해 주세요.',409);}
 if(p.kind==='activity'&&'relation' in data&&data.relation==='required'&&!data.prerequisite&&['working','done'].includes(String(data.state))&&(!previous||havrutaState(JSON.parse(String(previous.body)))!==data.state))throw new ApiError('선행 활동을 선택해 주세요.');
 if(p.kind==='activity'&&'prerequisite' in data&&data.prerequisite){if(data.prerequisite===entityId)throw new ApiError('자기 자신을 선행 활동으로 지정할 수 없습니다.');const prior=await db().prepare('SELECT body FROM spt_class_events WHERE owner=? AND entity_id=? AND student_id=? AND kind=? ORDER BY rowid DESC LIMIT 1').bind(user,data.prerequisite,p.studentId,'activity').first<{body:string}>();if(!prior)throw new ApiError('선행 활동을 먼저 보관해 주세요.',409);if(data.relation==='required'&&(!previous||havrutaState(JSON.parse(String(previous.body)))!==data.state)&&['working','done'].includes(String(data.state))&&(JSON.parse(prior.body).cancelled||havrutaState(JSON.parse(prior.body))!=='done')&&!data.overrideReason)throw new ApiError('선행 활동을 확인하거나 순서를 바꾼 이유를 남겨 주세요.',409);}
 const h=p.kind==='activity'?(data as Task).havruta:undefined;
 const groupGuard=h?" AND NOT EXISTS (SELECT 1 FROM spt_class_events WHERE owner=? AND json_extract(body,'$.havruta.groupId')=? AND (json_extract(body,'$.havruta.date') IS NOT ? OR json_extract(body,'$.havruta.members') IS NOT json(?) OR json_extract(body,'$.havruta.problem') IS NOT json(?)))":'';
 const done=await db().prepare("INSERT OR IGNORE INTO spt_class_events(id,owner,entity_id,student_id,class_date,kind,body,created_at,recorded_at_client,base_revision_id,schema_version) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT id FROM spt_class_events WHERE owner=? AND entity_id=? ORDER BY rowid DESC LIMIT 1),'')=?"+groupGuard).bind(p.id,user,entityId,p.studentId,p.date,p.kind,serialized,new Date().toISOString(),inputAt,revisionBase,1,user,entityId,p.baseId||'',...(h?[user,h.groupId,h.date,JSON.stringify(h.members),JSON.stringify(h.problem)]:[])).run();if(done.meta.changes!==1){const stored=await db().prepare('SELECT * FROM spt_class_events WHERE id=?').bind(p.id).first();if(stored&&stored.owner===user&&stored.entity_id===entityId&&stored.student_id===p.studentId&&stored.class_date===p.date&&stored.kind===p.kind&&stored.body===serialized&&stored.recorded_at_client===inputAt&&stored.base_revision_id===revisionBase)return result({saved:true,id:p.id});throw new ApiError('다른 화면에서 수정한 내용이 있습니다. 두 내용을 비교해 주세요.',409);}return result({saved:true,id:p.id});
 }catch(e){return failure(e)}}

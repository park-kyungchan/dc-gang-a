import {students,validDate,text,uuid,parse,exportDay,type Session,type Entry,type Capture,type Student} from './notebook';
import {validateTiming,type ActivityTiming} from './activity-time';
import {draftReviewSchema,type DraftReview} from './closeout-review';
import {clientRecordedAt} from './provenance';
import {scopeSchema,scopeDraftSchema,type CurriculumScope} from './curriculum';
import {diarySchema,assertDiaryReady,parentDiarySchema,type ParentDiary,type PublicDiary} from './diary-draft';
import {homeworkPlanSchema,homeworkDraftSchema,homeworkText,type HomeworkPlan} from './homework';
import {activityScopeDraftsSchema} from './activity-scope';
import {havrutaSchema,havrutaState,type Havruta} from './havruta';

export type ClassEvent={id:string;entity_id:string;student_id:string;class_date:string;kind:string;body:string;created_at:string;recorded_at_client?:string|null;base_revision_id?:string|null;schema_version?:number|null;local_projection?:boolean};
export type Task={cancelled?:boolean;title:string;lane:'student'|'teacher';state:'assigned'|'working'|'student_done'|'check'|'done'|'pending'|'skipped';workDate:string;range:string;note:string;attempted:string;marked:string;corrected:string;unresolved:string;materials:string[];inspectedAt:string;feedbackAt:string;prerequisite:string;relation:'independent'|'recommended'|'required';overrideReason:string;timing?:ActivityTiming;scope?:CurriculumScope;havruta?:Havruta};
export type ClassStatus={instructionAt:string;departedAt:string};
export const blankClassStatus:ClassStatus={instructionAt:'',departedAt:''};
export type Closeout={progress:string;homework:string;due:string;noHomework:boolean;next:string;confirmed:boolean;departedAt:string;evidenceBasis?:string;draftReview?:DraftReview;test?:boolean;diary?:PublicDiary;homeworkPlan?:HomeworkPlan;parentInput?:ParentDiary};
export type Report={draft:string;summary:string;needs:string;next:string;parent:string;confirmed:boolean;basis:string;transferredAt:string};
export const blankCloseout:Closeout={progress:'',homework:'',due:'',noHomework:false,next:'',confirmed:false,departedAt:''};
export const blankReport:Report={draft:'',summary:'',needs:'',next:'',parent:'',confirmed:false,basis:'',transferredAt:''};
export const activityNames=['숙제 확인','Daily Restudy','DT','개념 학습','개념백지테스트','오답 재확인','마인드맵 작성','클리닉','심화 문제','교재·필기·풀이 점검'];
// Rename assignment choices without rewriting past activity evidence.
export function activityChoices(titles:string[]=activityNames){return [...new Set(titles.map(title=>title==='구두 확인'?'개념백지테스트':title))];}
export const taskLabels:Record<Task['state'],string>={assigned:'배정함',working:'진행 중',student_done:'학생 마침 · 강사 확인 전',check:'교사 확인 필요',done:'활동 확인 마침',pending:'남은 일',skipped:'이번에는 생략'};
export function task(title:string,date:string):Task{return {cancelled:false,title,lane:(title==='개념백지테스트'||/확인|점검/.test(title))?'teacher':'student',state:'assigned',workDate:date,range:'',note:'',attempted:'',marked:'',corrected:'',unresolved:'',materials:[],inspectedAt:'',feedbackAt:'',prerequisite:'',relation:'independent',overrideReason:''};}
export function values<T>(event:ClassEvent|undefined,fallback:T):T{return event?{...fallback,...JSON.parse(event.body)}:fallback;}
export function entity(kind:string,studentId:string,date:string){return `${kind}:${studentId}:${date}`;}
export function classStatus(ledger:ClassEvent[],studentId:string,date:string):ClassStatus{
 const current=ledger.find(e=>e.entity_id===entity('class_status',studentId,date));
 if(current)return values(current,blankClassStatus);
 // Existing explicit departure evidence remains a fact even if later text
 // invalidates a detailed closeout. New status revisions own later corrections.
 const previous=values(ledger.find(e=>e.entity_id===entity('closeout',studentId,date)),blankCloseout);
 return {...blankClassStatus,departedAt:previous.departedAt};
}
export function classPart(studentId:string,date:string,roster:Student[]=students){return studentId==='S004'&&date==='2026-09-12'?'보강':roster.find(s=>s.id===studentId)?.part||'';}
export function classTime(studentId:string,date:string,roster:Student[]=students){return studentId==='S004'&&date==='2026-09-12'?'10:01–12:30':roster.find(s=>s.id===studentId)?.time||'';}
export function sourceLesson(studentId:string,date:string){if(studentId==='S004'&&date==='2026-09-12')return '보강 · 9/7 결석 원수업 · MKP-20260910-S004-01';if(date==='2026-09-09')return studentId==='S004'?'SES-20260909-MW-1':studentId==='S003'?'SES-20260909-WF-2':'';return '';}
export function completeCloseout(c:Closeout){return !!c.progress.trim()&&(c.noHomework||!!c.homework.trim()&&validDate(c.due));}
export function isOpen(t:Task){return !t.cancelled&&(!['done','skipped'].includes(havrutaState(t))||!!t.unresolved.trim());}
export function validateClass(kind:string,input:unknown,date:string){
 if(!input||typeof input!=='object')throw new Error('입력 형식을 확인해 주세요.');const p=input as Record<string,unknown>;
 const str=(key:string,max=12000)=>text(p[key]??'',max),bool=(key:string)=>p[key]===true;
 if(kind==='class_status')return {instructionAt:clientRecordedAt(p.instructionAt)??'',departedAt:clientRecordedAt(p.departedAt)??''};
 if(kind==='activity'){
  if(!Object.keys(taskLabels).includes(String(p.state))||!['student','teacher'].includes(String(p.lane))||!['independent','recommended','required'].includes(String(p.relation))||!validDate(p.workDate))throw new Error('입력한 활동 상태를 확인해 주세요.');
  const title=str('title',150).trim();if(!title)throw new Error('입력한 활동 이름을 확인해 주세요.');const prerequisite=str('prerequisite',100);if(prerequisite&&!uuid(prerequisite))throw new Error('입력한 선행 활동을 확인해 주세요.');
  const materials=Array.isArray(p.materials)?p.materials.filter(x=>typeof x==='string'&&['개념서','필기 노트','풀이 노트'].includes(x)):[];
  const timing=validateTiming(p.timing);
  return {...(p.cancelled===undefined?{}:{cancelled:bool('cancelled')}),title,lane:p.lane,state:p.state,workDate:p.workDate,range:str('range',2000),note:str('note'),attempted:str('attempted',2000),marked:str('marked',2000),corrected:str('corrected',2000),unresolved:str('unresolved',2000),materials,inspectedAt:str('inspectedAt',40),feedbackAt:str('feedbackAt',40),prerequisite,relation:p.relation,overrideReason:str('overrideReason',2000),...(timing?{timing}:{}),...(p.scope===undefined?{}:{scope:scopeSchema.parse(p.scope)}),...(p.havruta===undefined?{}:{havruta:havrutaSchema.parse(p.havruta)})};
 }
 if(kind==='closeout'||kind==='closeout_test'){
  const testMode=kind==='closeout_test';if(p.test!==undefined&&typeof p.test!=='boolean'||(p.test===true)!==testMode)throw new Error('입력한 테스트 구분을 확인해 주세요.');
  const c:Closeout={...(testMode?{test:true}:{}),progress:str('progress'),homework:str('homework'),due:str('due',10),noHomework:bool('noHomework'),next:str('next'),confirmed:bool('confirmed'),departedAt:str('departedAt',40),...(p.evidenceBasis===undefined?{}:{evidenceBasis:str('evidenceBasis',200)}),...(p.draftReview===undefined?{}:{draftReview:draftReviewSchema.parse(p.draftReview)}),...(p.diary===undefined?{}:{diary:diarySchema.parse(p.diary)}),...(p.homeworkPlan===undefined?{}:{homeworkPlan:homeworkPlanSchema.parse(p.homeworkPlan)}),...(p.parentInput===undefined?{}:{parentInput:parentDiarySchema.parse(p.parentInput)})};
  if(c.homeworkPlan&&(c.homework!==homeworkText(c.homeworkPlan)||(c.noHomework?c.homeworkPlan.items.length!==0:!c.homeworkPlan.items.length||!validDate(c.due))))throw new Error('숙제 선택 범위·기한과 저장 내용을 대조하세요.');
  if(c.homeworkPlan&&!c.noHomework&&c.due<date)throw new Error('숙제 기한은 대상 수업일보다 이전일 수 없습니다. 입력한 날짜를 확인하세요.');
  if(c.parentInput&&c.parentInput.date!==date)throw new Error('공개 일지의 원래 수업일을 유지하세요.');
  if(c.confirmed&&!completeCloseout(c))throw new Error('입력한 실제 진도와 숙제 범위·기한을 확정해 주세요.');if(c.confirmed&&c.diary)assertDiaryReady(c.diary);return c;
 }
 if(kind==='report'){const r:Report={draft:str('draft',100000),summary:str('summary'),needs:str('needs'),next:str('next'),parent:str('parent'),confirmed:bool('confirmed'),basis:str('basis',20000),transferredAt:str('transferredAt',40)};if(r.confirmed&&(!r.summary.trim()||!r.basis))throw new Error('확인한 내용과 검토 근거를 확인해 주세요.');if(r.transferredAt&&(!r.confirmed||!r.parent.trim()))throw new Error('학부모 문안과 교사 검토를 확인해 주세요.');return r;}
 if(kind==='plan'){
  const titles=Array.isArray(p.titles)?p.titles.map(x=>text(x,150).trim()).filter(Boolean):[];
  if(titles.length>30)throw new Error('입력한 활동 후보는 30개 이내로 작성해 주세요.');
  const homework=p.homeworkDraft===undefined?{}:{homeworkDraft:homeworkDraftSchema.parse(p.homeworkDraft)};
  const edits=p.activityScopeDrafts===undefined?{}:{activityScopeDrafts:activityScopeDraftsSchema.parse(p.activityScopeDrafts)};
  if(p.scopeDraft!==undefined){const d=p.scopeDraft as {scope:unknown;activities:unknown};if(!d||!Array.isArray(d.activities)||d.activities.length>30)throw new Error('공통 범위 활동 후보를 확인해 주세요.');return {titles,...homework,...edits,scopeDraft:{scope:d.scope===null?null:scopeDraftSchema.parse(d.scope),activities:d.activities.map(v=>text(v,150))}};}
  return {titles,...homework,...edits};
 }
 throw new Error('입력한 기록 종류를 확인해 주세요.');
}
export function signature(value:string){let a=2166136261,b=5381;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i);}return (a>>>0).toString(36)+(b>>>0).toString(36)+':'+value.length;}
// Cancelling an old confirmation must not make it restorable under new evidence.
export function reportConfirmationKey(report:Pick<Report,'confirmed'|'basis'>,basis:string){return 'confirm:'+(report.confirmed?report.basis:basis);}
export function reportCheckKey(report:Report,basis:string,closeConfirmed:boolean){return signature(JSON.stringify([basis,closeConfirmed,report.draft,report.summary,report.needs,report.next]));}
export function reviewBasis(studentId:string,date:string,ledger:ClassEvent[],sessions:Session[],events:Entry[]){
 const ss=sessions.filter(s=>s.student_id===studentId&&s.class_date===date&&!isTest(s));
 // Revisions are part of the basis: a later observation invalidates confirmation.
 return [...ledger.filter(e=>e.student_id===studentId&&e.kind!=='report'&&e.kind!=='closeout_test'&&(e.class_date===date||e.kind==='activity'&&(JSON.parse(e.body).workDate===date||JSON.parse(e.body).workDate<date&&isOpen(JSON.parse(e.body))))).map(e=>e.id+':'+signature(e.body)),...ss.map(s=>s.id+':'+(s.ended_at||'')),...events.filter(e=>ss.some(s=>s.id===e.session_id)).map(e=>e.id+':'+signature(e.body))].sort().join('|');
}
export const legacyTests=new Set(['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']);
export function isTest(s:Session){return s.purpose==='test'||legacyTests.has(s.id);}
export function exportClass(date:string,scope:string,ledger:ClassEvent[],sessions:Session[],events:Entry[],captures:Capture[],roster:Student[]=students){
 const selected=roster.filter(s=>scope==='all'||classPart(s.id,date,roster)===scope),ids=new Set(selected.map(s=>s.id));
 const ss=sessions.filter(s=>ids.has(s.student_id)&&!isTest(s));
 const lines=[exportDay(date,ss,events,captures,roster),'\n# 학생별 수업 운영 근거'];
 for(const s of selected){const records=ledger.filter(e=>e.student_id===s.id&&e.kind!=='closeout_test'&&(e.class_date===date||e.kind==='activity'&&isOpen(JSON.parse(e.body))));if(!records.length&&!ss.some(x=>x.student_id===s.id))continue;lines.push(`## ${s.name} · ${s.id} · ${classPart(s.id,date,roster)} · ${sourceLesson(s.id,date)}`);for(const e of records)lines.push(`근거 ${e.id} · ${e.kind} · 원수업 ${e.class_date}`,e.body);}
 lines.push('\n학생별로 실제 진도 / 숙제 범위·기한 / 직접 관찰 / 학생 자기보고 / 미해결·다음 확인 / 학부모 리포트 초안을 묶어 작성하라. 확인되지 않은 진도·숙제는 미확인으로 표시하라. 초안과 교사 확정을 구분하고 전달용 문안에 내부 추측·학생 비교·고정적 성향 판단을 넣지 마라. 발송하지 마라.');
 return lines.join('\n\n');
}

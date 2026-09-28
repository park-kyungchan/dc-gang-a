import {z} from 'zod';
import {scopeSchema,scopeDraftSchema,scopeText,scopeRangeText,type CurriculumCatalog,assertScopeCurrent} from './curriculum';
import {validDate,type Student} from './notebook';

const line=z.string().min(1).max(150).refine(v=>!!v.trim()&&!/[\r\n]/.test(v));
export const homeworkItemSchema=z.object({id:z.string().uuid(),scope:scopeSchema,actions:z.array(line).min(1).max(12)}).strict();
export const homeworkPlanSchema=z.object({items:z.array(homeworkItemSchema).max(20)}).strict().superRefine((v,c)=>{
 if(new Set(v.items.map(i=>i.id)).size!==v.items.length||v.items.some(i=>!scopeRangeText(i.scope).trim()))c.addIssue({code:'custom',message:'숙제별 실제 범위와 고유 항목을 확인하세요.'});
});
export type HomeworkPlan=z.infer<typeof homeworkPlanSchema>;
export const homeworkDraftSchema=z.object({items:z.array(homeworkItemSchema).max(20),due:z.string().max(10),noHomework:z.boolean(),scope:scopeDraftSchema.nullable(),actions:z.array(line).max(12),editingId:z.string().uuid().nullable().optional()}).strict().superRefine((v,c)=>{if(v.editingId&&!v.items.some(i=>i.id===v.editingId))c.addIssue({code:'custom',message:'수정 중인 원래 숙제 항목을 확인하세요.'});});
export type HomeworkDraft=z.infer<typeof homeworkDraftSchema>;
export function defaultHomeworkActions(bookLabel:string){
 // GaussPlus is a workbook, not the concept/preview homework default.
 if(/가우스플러스|가우스 플러스|GaussPlus/i.test(bookLabel))return [];
 if(/가우스|Gauss/i.test(bookLabel))return ['개념 예습','예습영상 촬영'];
 if(/다빈치|Davinci/i.test(bookLabel))return ['문제 풀이'];
 return [];
}
export function homeworkText(plan:HomeworkPlan){return plan.items.map(i=>scopeText(i.scope)+': '+i.actions.join('·')).join('\n');}
export function assertHomeworkCurrent(plan:HomeworkPlan,catalog:CurriculumCatalog|null,studentId:string,prior?:HomeworkPlan){
 for(const item of plan.items){const old=prior?.items.find(i=>i.id===item.id);if(JSON.stringify(old?.scope)!==JSON.stringify(item.scope))assertScopeCurrent(item.scope,catalog,studentId);}
}

const scheduleSchema=z.object({revision:z.string().min(1),lessons:z.array(z.object({id:z.string(),date:z.string(),className:z.string(),part:z.string(),status:z.string()})),makeups:z.array(z.object({id:z.string(),studentId:z.string(),date:z.string(),status:z.string(),confirmation:z.string()}))});
const profileSchema=z.object({id:z.string(),revision:z.string(),status:z.string(),className:z.string(),part:z.string(),days:z.string(),firstDate:z.string()});
const snapshotSchema=z.object({readAt:z.string(),profileSource:z.object({profiles:z.array(profileSchema)}),schedule:scheduleSchema});
export type HomeworkDue={date:string|null;reason:string;sourceRefs:string[];readAt:string};
/** Resolve from existing source observations, never from attendance or prose. */
export function nextHomeworkDue(student:Student,date:string,snapshot:unknown):HomeworkDue{
 const missing=(reason:string):HomeworkDue=>({date:null,reason,sourceRefs:[],readAt:''});
 if(!validDate(date))return missing('수업일 확인 필요');
 const parsed=snapshotSchema.safeParse(snapshot);if(!parsed.success)return missing('원본 일정·보강 확인 전');
 const s=parsed.data,profiles=s.profileSource.profiles.filter(p=>p.id===student.id),p=profiles[0];
 if(profiles.length!==1||p.status!=='재원'||student.active===false||!validDate(p.firstDate))return missing('재원·첫 수업일 확인 필요');
 const tokens=p.days.replace(/요일/g,'').split(/[\s·,、/]+/).filter(Boolean);
 if(!tokens.length||!tokens.every(t=>/^[일월화수목금토]+$/.test(t)))return missing('정규 요일 확인 필요');
 const days=new Set(tokens.join('').split('').map(c=>'일월화수목금토'.indexOf(c)));
 const makeups=s.schedule.makeups.filter(m=>m.studentId===student.id);
 const lessons=s.schedule.lessons.filter(l=>l.className===p.className&&l.part===p.part);
 if([...lessons,...makeups].some(r=>r.date&&!validDate(r.date)))return missing('원본 일정 날짜 대조 필요');
 const start=new Date(date+'T12:00:00Z');
 for(let n=1;n<=366;n++){
  const day=new Date(start.getTime()+n*86400000),iso=day.toISOString().slice(0,10);if(iso<p.firstDate)continue;
  const occurrences=lessons.filter(l=>l.date===iso),extra=makeups.filter(m=>m.date===iso&&m.status!=='취소');
  if(occurrences.length>1||occurrences.some(l=>!['예정','완료','취소'].includes(l.status))||extra.some(m=>m.status!=='예정'||m.confirmation!=='확정'))return missing('일정·보강 상태 대조 필요');
  const makeup=extra.find(m=>m.status==='예정'&&m.confirmation==='확정');
  const regular=occurrences.length?occurrences[0].status==='예정':days.has(day.getUTCDay());
  if(makeup||regular)return {date:iso,reason:makeup?'확정 보강':'다음 정규 수업',readAt:s.readAt,sourceRefs:[`profile:${p.id}:${p.revision}`,`schedule:${s.schedule.revision}`,...(makeup?[`makeup:${makeup.id}`]:occurrences.map(l=>`lesson:${l.id}`))]};
 }
 return missing('다음 수업 확인 필요');
}

import {z} from 'zod';
import type {Task,ClassEvent} from './classroom';
import {validDate} from './notebook';
import {transitionTiming} from './activity-time';
import {scopeSchema} from './curriculum';

const member=z.object({studentId:z.string().min(1).max(40),activityId:z.string().uuid()}).strict();
export const havrutaSchema=z.object({version:z.literal(1),groupId:z.string().uuid(),date:z.string().refine(validDate),members:z.array(member).min(2).max(30),problem:z.object({kind:z.literal('teacher_issued')}).strict(),review:z.object({decision:z.enum(['pass','retry']),at:z.string().datetime(),basis:z.string().min(1).max(30000)}).strict().nullable()}).strict().superRefine((h,ctx)=>{
 if(new Set(h.members.map(m=>m.studentId)).size!==h.members.length||new Set(h.members.map(m=>m.activityId)).size!==h.members.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'하브루타 참여 학생·활동은 중복될 수 없습니다.'});
});
export type Havruta=z.infer<typeof havrutaSchema>;
export type HavrutaDraft={groupId:string;date:string;selected:string[];members:Havruta['members'];assignedAt:string;revision?:string};

export function havrutaManifest(h:Havruta){return JSON.stringify({version:h.version,groupId:h.groupId,date:h.date,members:h.members,problem:h.problem});}
/** Exact meaningful work context, not a collision-prone short hash or note clock. */
export function havrutaBasis(t:Task){
 let scope:unknown=null;
 if(t.scope){const s=scopeSchema.parse(t.scope);scope={bookId:s.bookId,unitIds:s.unitIds,notation:s.notation,startKnowledge:s.startKnowledge,startPage:s.startPage,endPage:s.endPage,detail:s.detail,pageRanges:s.pageRanges,excludedPages:s.excludedPages};}
 return JSON.stringify({group:t.havruta?havrutaManifest(t.havruta):null,date:t.workDate,scope,range:t.range,attempted:t.attempted,marked:t.marked,corrected:t.corrected,unresolved:t.unresolved});
}
export function havrutaPassed(t:Task){return !!t.havruta&&!t.cancelled&&t.state==='done'&&t.havruta.review?.decision==='pass'&&t.havruta.review.basis===havrutaBasis(t);}
export function havrutaState(t:Task):Task['state']{return t.havruta&&t.state==='done'&&!havrutaPassed(t)?'check':t.state;}
export function havrutaLabel(t:Task){return ({assigned:'협동문제 배정',working:'협동 풀이',student_done:'설명 대기',check:'설명·재확인 필요',done:'교사 통과',pending:'남은 일',skipped:'이번에는 생략'} as const)[havrutaState(t)];}
export function havrutaStatePatch(t:Task,state:Task['state'],at=new Date().toISOString()):Partial<Task>{
 const timing=transitionTiming(t.timing,state,at);
 if(!t.havruta)return {state,timing};
 if(t.cancelled)throw new Error('취소된 하브루타는 참여 복원 후 확인하세요.');
 const review=state==='done'||state==='check'?{decision:state==='done'?'pass' as const:'retry' as const,at,basis:havrutaBasis(t)}:null;
 return {state,timing,havruta:{...t.havruta,review}};
}
export function assertHavrutaTransition(next:Task,prior:Task|undefined,studentId:string,activityId:string,date:string){
 if(prior?.havruta&&!next.havruta)throw new Error('기존 하브루타의 관계·통과 근거를 제거할 수 없습니다.');
 if(!next.havruta)return;
 const h=havrutaSchema.parse(next.havruta);
 if(prior&&!prior.havruta)throw new Error('기존 자유기록을 협동 하브루타로 자동 변환하지 않습니다. 새 모둠을 배정하세요.');
 if(h.date!==date||!h.members.some(m=>m.studentId===studentId&&m.activityId===activityId)||next.title!=='하브루타'||next.lane!=='student')throw new Error('하브루타의 원수업·참여 학생·활동 관계를 확인하세요.');
 if(prior?.havruta&&havrutaManifest(h)!==havrutaManifest(prior.havruta))throw new Error('기존 하브루타 참여 관계는 보존합니다. 다시 구성하려면 새 모둠을 배정하세요.');
 const sameReview=!!prior&&JSON.stringify(h.review)===JSON.stringify(prior.havruta?.review);
 if(prior&&next.state!==prior.state&&sameReview&&h.review)throw new Error('새 활동 상태에서는 이전 통과를 그대로 재사용하지 않습니다. 교사 동작으로 확인하세요.');
 if(!prior&&h.review)throw new Error('하브루타 배정과 교사 확인은 별도입니다.');
 if(h.review&&!sameReview&&(next.cancelled||h.review.basis!==havrutaBasis(next)||(h.review.decision==='pass'?next.state!=='done':next.state!=='check')))throw new Error('현재 문제·범위에 대한 교사 확인을 기록하세요.');
 // Scope/work evidence edits retain the historical decision but invalidate its
 // displayed applicability; generic done without a decision is never accepted.
 if(next.state==='done'&&!havrutaPassed(next)&&!(prior?.state==='done'&&sameReview&&!!h.review))throw new Error('하브루타는 설명을 확인한 교사 통과가 필요합니다.');
}
export function havrutaGroups(ledger:ClassEvent[],date:string){
 const groups=new Map<string,Havruta>();
 for(const e of ledger){if(e.kind!=='activity')continue;const t=JSON.parse(e.body) as Task;if(t.havruta?.date===date)groups.set(t.havruta.groupId,t.havruta);}
 return [...groups.values()].map(h=>({id:h.groupId,date:h.date,members:h.members,rows:h.members.map(m=>{const event=ledger.find(e=>e.entity_id===m.activityId&&e.student_id===m.studentId&&e.kind==='activity');const t=event?JSON.parse(event.body) as Task:undefined;const task=t?.havruta&&havrutaManifest(t.havruta)===havrutaManifest(h)?t:undefined;return {...m,event:task?event:undefined,task};})}));
}

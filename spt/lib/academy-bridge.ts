import {env} from 'cloudflare:workers';
import {ApiError,db} from './server';
import {uuid} from './notebook';
import {readRoster} from './roster-server';
import {closeoutCurrent,closeoutEvidenceBasis} from './closeout-review';
import {loadCloseoutEvidence} from './closeout-analysis';
import {diarySchema,assertDiaryReady} from './diary-draft';
import {rehearsalId} from './rehearsal';
import type {ClassEvent,Closeout} from './classroom';
export function academyConfigured(user:string){const e=env as unknown as Record<string,string>;return !rehearsalId()&&e.SPT_ACADEMY_OWNER_KEY===user&&!!e.SPT_ACADEMY_TOKEN&&/^http:\/\/127\.0\.0\.1:\d+\/academy$/.test(e.SPT_ACADEMY_URL||'');}
export async function academyEntry(user:string,id:unknown){
 if(!uuid(id))throw new ApiError('검토한 수정본 ID를 확인해 주세요.');
 const e=await db().prepare('SELECT id,entity_id,student_id,class_date,kind,body,created_at FROM spt_class_events WHERE id=? AND owner=?').bind(id,user).first<ClassEvent>();
 if(!e||e.kind!=='closeout'||rehearsalId())throw new ApiError('실제 학생의 검토 기록만 학원에 입력할 수 있습니다.',409);
 return e;
}
export async function reviewedAcademySource(user:string,id:unknown){
 const e=await academyEntry(user,id);
 const latest=await db().prepare('SELECT id FROM spt_class_events WHERE owner=? AND entity_id=? ORDER BY rowid DESC LIMIT 1').bind(user,e.entity_id).first<{id:string}>();
 const c=JSON.parse(e.body) as Closeout;
 if(latest?.id!==e.id||c.test||!c.evidenceBasis||!closeoutCurrent(c,closeoutEvidenceBasis(e.student_id,e.class_date,await loadCloseoutEvidence(user,e.student_id,e.class_date))))throw new ApiError('최신 근거로 진도·숙제와 학원 공개 일지를 다시 확정해 주세요.',409);
 const diary=diarySchema.parse(c.diary);assertDiaryReady(diary);
 const student=(await readRoster(user)).roster.find(s=>s.id===e.student_id);if(!student)throw new ApiError('원본 학생 연결을 확인해 주세요.',409);
 return {entryId:e.id,studentId:e.student_id,studentName:student.name,date:e.class_date,kind:e.kind,confirmed:c.confirmed,test:false,evidenceCurrent:true,fields:{progress:diary.progress,homework:diary.homework,class_memo:diary.classMemo}};
}
export async function academyCall(user:string,payload:Record<string,unknown>){
 if(!academyConfigured(user))throw new ApiError('이 운영 앱의 학원 입력 연결을 확인해 주세요.',503);
 const e=env as unknown as Record<string,string>;
 const response=await fetch(e.SPT_ACADEMY_URL,{method:'POST',headers:{'Content-Type':'application/json','X-SPT-Owner':user,'Authorization':'Bearer '+e.SPT_ACADEMY_TOKEN},body:JSON.stringify(payload),signal:AbortSignal.timeout(180000),redirect:'manual'});
 // workerd supports manual/follow, not error. Never follow a native redirect
 // with the bound credential, and reject it before attempting JSON decoding.
 if(!response.ok)throw new ApiError('학원 연결·학생 매핑 또는 최신 검토 상태를 확인해 주세요. 불명확한 결과는 재조회하며 자동 재입력하지 않습니다.',502);
 return await response.json() as Record<string,unknown>;
}

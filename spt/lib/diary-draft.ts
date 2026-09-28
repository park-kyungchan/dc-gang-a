import {z} from 'zod';
import type {ClassEvent,Task,Closeout} from './classroom';
import {scopeText,scopeRangeText,shortBookLabel,pageListText} from './curriculum';
import {havrutaLabel,havrutaPassed} from './havruta';

export const diarySchema=z.object({progress:z.string().max(12000),homework:z.string().max(12000),classMemo:z.string().max(12000)}).strict();
export type PublicDiary=z.infer<typeof diarySchema>;
export const blankDiary:PublicDiary={progress:'',homework:'',classMemo:''};
/** Mirrors inspected academy reallength, in UTF-16 units; never truncates. */
export function academyLength(value:string){let n=0;for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>=32)n+=c>128?2:1;}return n;}
export function diaryLimit(value:string){return {characters:[...value].length,legacyLength:academyLength(value),valid:[...value].length<=200&&academyLength(value)<=400};}
export function diaryReady(value:PublicDiary){return !!value.progress.trim()&&!!value.homework.trim()&&Object.values(value).every(v=>diaryLimit(v).valid);}
export function assertDiaryReady(value:PublicDiary){if(!diaryReady(value))throw new Error('학원 공개 일지는 진도·숙제를 확인하고 각 200자 이내로 다듬어 주세요. 원문은 자르지 않고 보존합니다.');}
const stateLabel:Record<Task['state'],string>={assigned:'배정',working:'진행',student_done:'학생 마침·확인 전',check:'확인 필요',done:'교사 확인',pending:'남은 일',skipped:'생략'};
const displayTitle=(title:string)=>title==='DT'?'Daily Test':title==='클리닉'?'Clinic':title;
export function makeDiaryDraft(studentId:string,date:string,ledger:ClassEvent[]){
 const groups=new Map<string,{range:string;activities:string[];sourceIds:string[]}>();
 for(const e of ledger){if(e.student_id!==studentId||e.kind!=='activity')continue;const t=JSON.parse(e.body) as Task;if(t.workDate!==date||t.cancelled)continue;
  const range=t.range||(t.scope?scopeText(t.scope):'범위 미기록');
  // Manual changes, distinct source paths and activity states remain factual.
  const key=JSON.stringify([t.scope||null,range]);let g=groups.get(key);if(!g){g={range,activities:[],sourceIds:[]};groups.set(key,g);}
  g.activities.push(displayTitle(t.title)+'('+(t.havruta?havrutaLabel(t):stateLabel[t.state])+')');g.sourceIds.push(e.id);
 }
 const blocks=[...groups.values()];const text=blocks.map(g=>g.range+': '+g.activities.join('·')).join('\n');
 return {text,blocks,...diaryLimit(text),needsTeacherReview:true as const};
}

// Reviewed semantic input -> the academy's existing three public text fields.
// This does not infer facts, resolve schedules or perform persistence/sending.
const parentLine=z.string().min(1).max(1200).refine(v=>!!v.trim()&&!/[\r\n]/.test(v),'한 항목은 줄바꿈 없이 입력하세요.');
const parentDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{
 const day=new Date(v+'T00:00:00.000Z');
 return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===v;
},'정확한 날짜가 필요합니다.');
const parentSources=z.array(parentLine).min(1).max(30);
const parentBook={bookId:parentLine.nullable(),bookLabel:parentLine};
const parentProgressItem=z.object({scope:parentLine,actions:z.array(parentLine).min(1).max(12),results:z.array(parentLine).max(12),sourceRefs:parentSources}).strict();
const parentHomeworkItem=z.object({scope:parentLine,actions:z.array(parentLine).min(1).max(12),exclusions:z.array(parentLine).max(12),sourceRefs:parentSources}).strict();
const parentHomeworkBook=z.object({...parentBook,none:z.boolean(),items:z.array(parentHomeworkItem).max(12)}).strict().superRefine((v,ctx)=>{
 if(v.none?v.items.length!==0:v.items.length===0)ctx.addIssue({code:z.ZodIssueCode.custom,message:'교재별 숙제 있음/없음과 할 일을 일치시켜 주세요.'});
});
export const parentDiarySchema=z.object({
 version:z.literal('spt.parent-diary.v1'),studentId:z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),date:parentDate,
 progress:z.array(z.object({...parentBook,items:z.array(parentProgressItem).min(1).max(12)}).strict()).min(1).max(10),
 homework:z.object({none:z.boolean(),due:parentDate.nullable(),books:z.array(parentHomeworkBook).max(10)}).strict(),
 memos:z.array(z.object({kind:z.enum(['progress','homework','message']),text:parentLine,sourceRefs:parentSources}).strict()).max(12),
}).strict().superRefine((v,ctx)=>{
 const h=v.homework;
 if(h.none?(h.due!==null||h.books.length!==0):(!h.due||!h.books.length||h.books.every(b=>b.none)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'다음 숙제·기한 또는 전체 숙제 없음을 확인하세요.'});
 for(const books of [v.progress,h.books]){
  const ids=books.map(b=>b.bookId).filter((id):id is string=>id!==null);
  if(new Set(ids).size!==ids.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'같은 교재는 한 묶음 안에서 범위를 나누세요.'});
 }
});
export type ParentDiary=z.infer<typeof parentDiarySchema>;
const memoLabels={progress:'수업 참고',homework:'숙제 참고',message:'안내'} as const;
function parentDue(date:string){
 const day=new Date(date+'T00:00:00.000Z');
 return `${day.getUTCMonth()+1}/${day.getUTCDate()}(${'일월화수목금토'[day.getUTCDay()]})까지`;
}
export function previewParentDiary(input:unknown){
 const value=parentDiarySchema.parse(input);
 // The real academy writer/readback represents submitted lines as CRLF.
 // Input parts forbid embedded line breaks; only these generated boundaries
 // change. Preserve exact source comparison rather than normalizing its result.
 const eol='\r\n';
 const progress=value.progress.map(book=>[`[${book.bookLabel}]`,...book.items.flatMap(item=>[
  `- ${item.scope}: ${item.actions.join('·')}`,...item.results.map(result=>'- '+result),
 ])].join(eol)).join(eol+eol);
 const homework=value.homework.none?'다음 수업 전 숙제 없음':[
  parentDue(value.homework.due!),
  value.homework.books.map(book=>[`[${book.bookLabel}]`,...(book.none?['- 숙제 없음']:book.items.flatMap(item=>[
   `- ${item.scope}: ${item.actions.join('·')}`,...item.exclusions.map(exclusion=>'- 제외: '+exclusion),
  ]))].join(eol)).join(eol+eol),
 ].join(eol);
 const fields:PublicDiary={progress,homework,classMemo:value.memos.map(m=>`[${memoLabels[m.kind]}] ${m.text}`).join(eol)};
 const limits={progress:diaryLimit(fields.progress),homework:diaryLimit(fields.homework),classMemo:diaryLimit(fields.classMemo)};
 return {version:value.version,lineEnding:'CRLF',studentId:value.studentId,date:value.date,fields,limits,ready:diaryReady(fields),emptyMemoEffect:fields.classMemo?'not_empty':'preserve'} as const;
}
export function renderParentDiary(input:unknown){
 const preview=previewParentDiary(input);assertDiaryReady(preview.fields);return preview.fields;
}

/** Explicitly reviewed activity choices, not assignment -> performed inference. */
export function parentInputFromClass(studentId:string,date:string,ledger:ClassEvent[],performedIds:string[],close:Closeout,closeoutRef:string):ParentDiary{
 if(!performedIds.length||new Set(performedIds).size!==performedIds.length)throw new Error('오늘 실제 수행한 활동과 범위를 선택해 확인하세요.');
 const progress:ParentDiary['progress']=[];
 for(const id of performedIds){
  const e=ledger.find(e=>e.id===id&&e.student_id===studentId&&e.kind==='activity');const t=e?JSON.parse(e.body) as Task:null;
  if(!e||!t||t.workDate!==date||t.cancelled||['assigned','skipped'].includes(t.state))throw new Error('활동 근거가 바뀌었습니다. 실제 수행 범위를 다시 확인하세요.');
  const label=t.scope?shortBookLabel(t.scope.bookLabel):'수업',bookId=t.scope?.bookId??null;
  const range=t.attempted.trim()||(t.scope?scopeRangeText(t.scope):t.range.trim())||(t.havruta?'교사 출제 협동 문제 · 상세 범위 미기록':'');if(!range)throw new Error('수행 범위를 먼저 보완해 주세요. 배정 범위 전체 수행을 추정하지 않습니다.');
  let book=progress.find(b=>b.bookId===bookId);if(!book){book={bookId,bookLabel:label,items:[]};progress.push(book);}
  let item=book.items.find(i=>i.scope===range);if(!item){item={scope:range,actions:[],results:[],sourceRefs:[]};book.items.push(item);}
  const action=t.havruta?'하브루타 · '+(havrutaPassed(t)?'교사 통과':'교사 통과 미확인'):t.title==='DT'?'일일테스트':t.title==='클리닉'?'유형 연습(Clinic)':t.title;
  if(!item.actions.includes(action))item.actions.push(action);item.sourceRefs.push(e.id);
 }
 const books:ParentDiary['homework']['books']=[];
 if(!close.noHomework){
  if(!close.homeworkPlan?.items.length)throw new Error('교재·범위로 숙제를 먼저 선택하세요. 기존 숙제 원문은 그대로 보존합니다.');
  for(const i of close.homeworkPlan.items){let book=books.find(b=>b.bookId===i.scope.bookId);if(!book){book={bookId:i.scope.bookId,bookLabel:shortBookLabel(i.scope.bookLabel),none:false,items:[]};books.push(book);}book.items.push({scope:scopeRangeText(i.scope,false),actions:i.actions,exclusions:i.scope.excludedPages?.length?['p.'+pageListText(i.scope.excludedPages)]:[],sourceRefs:[closeoutRef,`homework:${i.id}`,`catalog:${i.scope.catalogRevision}`]});}
 }
 return parentDiarySchema.parse({version:'spt.parent-diary.v1',studentId,date,progress,homework:{none:close.noHomework,due:close.noHomework?null:close.due,books},memos:[]});
}

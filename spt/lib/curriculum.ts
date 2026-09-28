import {z} from 'zod';

const id=z.string().min(1).max(100);
const page=z.number().int().min(1).max(10000).nullable();
const pageRange=z.object({start:z.number().int().min(1).max(10000),end:z.number().int().min(1).max(10000)}).strict();
/** Pending selection can retain a correctable conflict; committed scopes use scopeSchema. */
export const scopeDraftSchema=z.object({
 bookId:id,catalogRevision:z.string().min(1).max(200),bookLabel:z.string().min(1).max(300),
 unitIds:z.array(id).max(80),unitLabels:z.array(z.string().min(1).max(1000)).max(80),
 notation:z.string().max(2000),startKnowledge:z.enum(['known','unknown']),
 startPage:page,endPage:page,detail:z.string().max(2000),
 pageRanges:z.array(pageRange).min(1).max(80).optional(),excludedPages:z.array(z.number().int().min(1).max(10000)).max(1000).optional(),
}).strict();
export const scopeSchema=scopeDraftSchema.superRefine((v,c)=>{
 if(new Set(v.unitIds).size!==v.unitIds.length||v.unitIds.length!==v.unitLabels.length)c.addIssue({code:'custom',message:'선택한 목차 ID와 원문 경로를 확인해 주세요.'});
 if(v.startPage!==null&&v.endPage!==null&&v.endPage<v.startPage)c.addIssue({code:'custom',message:'지정한 페이지 범위를 확인해 주세요.'});
 if(v.startPage===null&&v.endPage!==null&&v.startKnowledge!=='unknown')c.addIssue({code:'custom',message:'시작 페이지가 미확정인 범위로 보관해 주세요.'});
 const ranges=v.pageRanges;
 if(ranges&&(v.startPage!==null||v.endPage!==null||v.startKnowledge!=='known'||ranges.some((r,i)=>r.end<r.start||i>0&&r.start<=ranges[i-1].end)))c.addIssue({code:'custom',message:'페이지 구간은 겹치지 않는 순서로 선택하세요. 이전 시작·끝과 중복하지 않습니다.'});
 if(v.excludedPages?.length){const spans=ranges||(v.startPage!==null?[{start:v.startPage,end:v.endPage??v.startPage}]:[]);const excluded=v.excludedPages;
  if(new Set(excluded).size!==excluded.length||excluded.some(p=>!spans.some(r=>p>=r.start&&p<=r.end))||excluded.length>=spans.reduce((n,r)=>n+r.end-r.start+1,0))c.addIssue({code:'custom',message:'제외 쪽은 선택 범위 안에 있어야 하며 실제 할 쪽이 남아야 합니다.'});
 }
});
export type CurriculumScope=z.infer<typeof scopeSchema>;
const bookSchema=z.object({id,name:z.string(),code:z.string(),source:z.string(),version:z.string(),start:page,end:page,excluded:z.array(z.number()),note:z.string().optional()}).passthrough();
const unitSchema=z.object({id,bookId:id,parentId:z.string(),level:z.number(),kind:z.string(),name:z.string(),start:page,end:page,order:z.number(),source:z.string(),notation:z.string().optional()}).passthrough();
const catalogSchema=z.object({revision:z.string().min(1),books:z.array(bookSchema).max(1000),units:z.array(unitSchema).max(10000),assignments:z.array(z.object({studentId:id,bookId:id,slot:z.number()}).passthrough()).max(5000)});
export type CurriculumCatalog=z.infer<typeof catalogSchema>;
export type CurriculumUnit=CurriculumCatalog['units'][number];
/** The original Tracker owns catalog/event interpretation, not a second TS calculator. */
export function catalogFromSnapshot(snapshot:unknown):CurriculumCatalog|null{
 const candidate=(snapshot as {tracker?:{resolvedCatalog?:unknown}}|null)?.tracker?.resolvedCatalog;
 const parsed=catalogSchema.safeParse(candidate);if(!parsed.success)return null;
 const c=parsed.data;
 if(new Set(c.books.map(b=>b.id)).size!==c.books.length||new Set(c.units.map(u=>u.id)).size!==c.units.length)return null;
 if(c.units.some(u=>!c.books.some(b=>b.id===u.bookId)||u.parentId&&!c.units.some(p=>p.id===u.parentId&&p.bookId===u.bookId)))return null;
 try{c.units.forEach(u=>unitPath(c,u.id));}catch{return null;}
 return c;
}
export function assignedBooks(c:CurriculumCatalog,studentId:string){return c.assignments.filter(a=>a.studentId===studentId).sort((a,b)=>a.slot-b.slot).flatMap(a=>c.books.filter(b=>b.id===a.bookId));}
export function unitPath(c:CurriculumCatalog,unitId:string):string{
 const path:string[]=[],seen=new Set<string>();let u=c.units.find(u=>u.id===unitId);
 if(!u)throw new Error('목차 원본을 찾지 못했습니다.');
 while(u){if(seen.has(u.id))throw new Error('목차 상위 경로가 순환합니다.');seen.add(u.id);path.unshift((u.notation?u.notation+'. ':'')+u.name);u=u.parentId?c.units.find(p=>p.id===u!.parentId):undefined;}
 return path.join(' / ');
}
export function makeScope(c:CurriculumCatalog,studentId:string,bookId:string,unitIds:string[]):CurriculumScope{
 const book=assignedBooks(c,studentId).find(b=>b.id===bookId);if(!book)throw new Error('이 학생에게 배정된 실제 교재를 선택해 주세요.');
 const selected=unitIds.map(id=>{const u=c.units.find(u=>u.id===id&&u.bookId===bookId);if(!u)throw new Error('교재와 목차가 일치하지 않습니다.');return u;});
 // Page limits are context, never an automatic whole-unit assignment.
 return scopeSchema.parse({bookId,catalogRevision:c.revision,bookLabel:book.name,unitIds,unitLabels:selected.map(u=>unitPath(c,u.id)),notation:selected.map(u=>u.notation||u.name).join(', '),startKnowledge:'known',startPage:null,endPage:null,detail:''});
}
export function assertScopeCurrent(scope:CurriculumScope,c:CurriculumCatalog|null,studentId:string){
 if(!c||scope.catalogRevision!==c.revision)throw new Error('목차 원본이 바뀌었거나 확인되지 않았습니다. 입력을 보존하고 최신 목차와 대조해 주세요.');
 const canonical=makeScope(c,studentId,scope.bookId,scope.unitIds);
 if(scope.bookLabel!==canonical.bookLabel||JSON.stringify(scope.unitLabels)!==JSON.stringify(canonical.unitLabels))throw new Error('교재·목차 원문 경로가 일치하지 않습니다.');
}
export function shortBookLabel(label:string){return label.split(' · ').filter(p=>p!=='본교재').join(' ');}
export function pageListText(pages:number[]){const spans:{start:number;end:number}[]=[];for(const p of [...new Set(pages)].sort((a,b)=>a-b)){const last=spans.at(-1);if(last&&p===last.end+1)last.end=p;else spans.push({start:p,end:p});}return spans.map(r=>r.start+(r.end===r.start?'':'~'+r.end)).join(', ');}
export function scopeRangeText(scope:CurriculumScope,includeExclusions=true){
 const pages=scope.pageRanges?'p.'+scope.pageRanges.map(r=>r.start+(r.end===r.start?'':'~'+r.end)).join(', '):scope.startPage!==null||scope.endPage!==null?'p.'+(scope.startPage??'')+(scope.endPage!==null&&scope.endPage!==scope.startPage?'~'+scope.endPage:''):'';
 const context=[...new Set(scope.unitLabels.filter(label=>label.includes(' / ')).map(label=>label.split(' / ')[0]))].filter(label=>!scope.notation.includes(label)).join('; ');
 return [context,scope.notation,pages,includeExclusions&&scope.excludedPages?.length?'(제외 p.'+pageListText(scope.excludedPages)+')':'',scope.detail,scope.startKnowledge==='unknown'?'(시작 미확정)':''].filter(Boolean).join(' ');
}
export function scopeText(scope:CurriculumScope){return [shortBookLabel(scope.bookLabel),scopeRangeText(scope)].filter(Boolean).join(' ');}

export function scopeDraftFeedback(scope:CurriculumScope|null):{kind:'incomplete'|'invalid'|'ready';message:string}{
 if(!scope)return {kind:'incomplete',message:'교재를 선택한 뒤 배정할 범위를 입력하세요.'};
 if(!scopeDraftSchema.safeParse(scope).success)return {kind:'invalid',message:'교재·쪽수 입력 형식을 확인하세요. 입력은 자동으로 지우지 않습니다.'};
 if(!scope.pageRanges&&scope.startKnowledge==='known'&&(scope.startPage===null)!==(scope.endPage===null))return {kind:'incomplete',message:'시작 쪽과 끝 쪽을 모두 입력하세요. 한 쪽이면 같은 번호를 입력하고, 시작을 모르면 시작 미확정을 선택하세요.'};
 const parsed=scopeSchema.safeParse(scope);
 if(!parsed.success){
  const ranges=scope.pageRanges||(scope.startPage!==null?[{start:scope.startPage,end:scope.endPage??scope.startPage}]:[]);
  const outside=(scope.excludedPages||[]).filter(p=>!ranges.some(r=>p>=r.start&&p<=r.end));
  if(outside.length&&ranges.length&&ranges.every(r=>r.end>=r.start))return {kind:'invalid',message:`범위 밖 제외: ${pageListText(outside)}쪽. 범위를 고치거나 해당 제외 쪽을 직접 지운 뒤 적용하세요.`};
  return {kind:'invalid',message:parsed.error.issues[0]?.message||'선택 범위를 확인하세요.'};
 }
 if(!scopeRangeText(scope).trim())return {kind:'incomplete',message:'배정할 단원 또는 실제 쪽수 범위를 입력하세요.'};
 return {kind:'ready',message:'범위 선택 완료 · 적용 전입니다.'};
}

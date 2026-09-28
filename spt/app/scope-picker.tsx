'use client';
import {useState} from 'react';
import {assignedBooks,makeScope,scopeText,shortBookLabel,scopeDraftFeedback,scopeSchema,pageListText,unitPath,type CurriculumCatalog,type CurriculumScope} from '@/lib/curriculum';

type Props={studentId:string;catalog:CurriculumCatalog|null;scope:CurriculumScope|null;onChange:(scope:CurriculumScope|null)=>void;disabled?:boolean;recentScopes?:CurriculumScope[];showFeedback?:boolean};
/** One draft chooser; numeric and grid input share the existing domain representation. */
export function ScopePicker({studentId,catalog,scope,onChange,disabled=false,recentScopes=[],showFeedback=true}:Props){
 const [windowStart,setWindowStart]=useState(()=>Math.floor(((scope?.pageRanges?.[0]?.start??scope?.startPage??1)-1)/35)*35+1);
 const [anchor,setAnchor]=useState<number|null>(null),[mode,setMode]=useState<'range'|'append'|'exclude'>('range');
 const books=catalog?assignedBooks(catalog,studentId):[],book=books.find(b=>b.id===scope?.bookId);
 const units=catalog&&scope?catalog.units.filter(u=>u.bookId===scope.bookId).sort((a,b)=>a.order-b.order):[];
 const stale=!!scope&&(!catalog||scope.catalogRevision!==catalog.revision);
 const ranges=scope?.pageRanges||(scope?.startPage!==null&&scope?.startPage!==undefined?[{start:scope.startPage,end:scope.endPage??scope.startPage}]:[]);
 const contains=(p:number)=>ranges.some(r=>p>=r.start&&p<=r.end);
 const feedback=scopeDraftFeedback(scope),multiple=!!scope?.pageRanges&&scope.pageRanges.length>1;
 const start=scope?.pageRanges?.length===1?scope.pageRanges[0].start:scope?.startPage??null;
 const end=scope?.pageRanges?.length===1?scope.pageRanges[0].end:scope?.endPage??null;
 const label=scope?shortBookLabel(book?.name||scope.bookLabel):'';
 const numeric=scope?.pageRanges?scope.pageRanges.map(r=>r.start===r.end?String(r.start):`${r.start}–${r.end}`).join(', ')+'쪽':start!==null||end!==null?`${start??(scope?.startKnowledge==='unknown'?'시작 미확정':'?')}–${end??'?'}쪽`:'쪽수 선택 전';
 const recent=recentScopes.filter(s=>s.bookId===scope?.bookId&&s.catalogRevision===catalog?.revision&&scopeSchema.safeParse(s).success&&(s.pageRanges||s.startPage!==null||s.endPage!==null)).slice(0,3);
 function patch(p:Partial<CurriculumScope>){if(scope)onChange({...scope,...p});}
 function selectBook(bookId:string){
  setAnchor(null);setMode('range');
  if(catalog&&bookId){const next=makeScope(catalog,studentId,bookId,[]);onChange(scope?{...next,startPage:scope.startPage,endPage:scope.endPage,startKnowledge:scope.startKnowledge,pageRanges:scope.pageRanges,excludedPages:scope.excludedPages,detail:scope.detail,notation:scope.unitIds.length?next.notation:scope.notation}:next);const first=scope?.pageRanges?.[0]?.start??scope?.startPage??books.find(b=>b.id===bookId)?.start??1;setWindowStart(Math.floor((first-1)/35)*35+1);}else onChange(null);
 }
 function endpoint(key:'startPage'|'endPage',value:string){
  if(!scope||multiple)return;setAnchor(null);
  const number=value===''?null:Number(value),nextStart=key==='startPage'?number:start,nextEnd=key==='endPage'?number:end;
  patch({pageRanges:undefined,startPage:nextStart,endPage:nextEnd,startKnowledge:nextStart!==null?'known':scope.startKnowledge});
 }
 function choosePage(p:number){
  if(!scope||stale)return;
  if(mode==='exclude'){if(!contains(p))return;const old=scope.excludedPages||[];patch({excludedPages:old.includes(p)?old.filter(x=>x!==p):[...old,p].sort((a,b)=>a-b)});return;}
  if(anchor===null){setAnchor(p);return;}
  const selected={start:Math.min(anchor,p),end:Math.max(anchor,p)},ordered=(mode==='append'?[...ranges,selected]:[selected]).sort((a,b)=>a.start-b.start),merged:typeof ordered=[];
  for(const r of ordered){const prior=merged.at(-1);if(prior&&r.start<=prior.end+1)prior.end=Math.max(prior.end,r.end);else merged.push({...r});}
  patch({pageRanges:merged,startPage:null,endPage:null,startKnowledge:'known'});setAnchor(null);
 }
 const last=book?.end??10000;
 return <div className="scope-picker">
  <label className="field">배정된 실제 교재<select aria-label="배정된 실제 교재" value={scope?.bookId||''} disabled={disabled||!catalog} onChange={e=>selectBook(e.target.value)}><option value="">교재 선택</option>{books.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
  {!catalog&&<p role="status">목차 원본 확인 전 · 기존 기록은 보존됩니다.</p>}
  {scope&&(stale?<p role="alert">목차가 바뀌었습니다. 이전 입력: {scopeText(scope)} · 원본을 대조한 뒤 교재를 다시 선택하세요.</p>:<>
   <h3>{label}의 쪽수</h3>
   <div className="scope-numeric"><div className="field-grid">
    <label className="field">시작 쪽<input aria-label="실제 시작 페이지" type="number" inputMode="numeric" min="1" max="10000" value={start??''} disabled={disabled||multiple} onChange={e=>endpoint('startPage',e.target.value)}/></label>
    <label className="field">끝 쪽<input aria-label="실제 끝 페이지" type="number" inputMode="numeric" min="1" max="10000" value={end??''} disabled={disabled||multiple} onChange={e=>endpoint('endPage',e.target.value)}/></label>
   </div>{multiple&&<><p className="hint">여러 구간을 그대로 보관 중입니다. 아래 그리드에서 구간을 추가하거나, 직접 단일 구간 입력을 선택하세요.</p><button type="button" disabled={disabled} onClick={()=>patch({pageRanges:undefined,startPage:null,endPage:null,startKnowledge:'known'})}>단일 구간으로 다시 입력</button></>}</div>
   {!!recent.length&&<div className="button-row" aria-label="최근 적용 범위">{recent.map((s,i)=><button type="button" key={i} disabled={disabled} onClick={()=>{setAnchor(null);patch({pageRanges:s.pageRanges,startPage:s.startPage,endPage:s.endPage,startKnowledge:s.startKnowledge});}}>최근 범위 · {scopeText(s)}</button>)}</div>}
   <p className="curriculum-preview" aria-label="선택 범위">{label} · {numeric} · 적용 전</p>
   {!!scope.excludedPages?.length&&<div className="scope-exclusions" aria-label="보관 중인 제외 쪽"><p className="hint">제외 {pageListText(scope.excludedPages)}쪽 · 범위가 바뀌어도 자동으로 지우지 않습니다.</p><div className="button-row">{scope.excludedPages.map((p,i)=><button type="button" key={`${p}-${i}`} disabled={disabled} aria-label={`제외 ${p}쪽 지우기`} onClick={()=>patch({excludedPages:scope.excludedPages?.filter(v=>v!==p)})}>{p}쪽 제외 지우기</button>)}</div></div>}
   {showFeedback&&<p role={feedback.kind==='invalid'?'alert':'status'} data-scope-state={feedback.kind}>{feedback.message}</p>}
   <details className="scope-toc"><summary>단원 선택{scope.unitIds.length?' · '+scope.notation:''}</summary><div className="curriculum-units">{units.map(u=><label key={u.id} className="curriculum-unit"><input type="checkbox" disabled={disabled} checked={scope.unitIds.includes(u.id)} onChange={e=>{if(!catalog)return;const next=makeScope(catalog,studentId,scope.bookId,e.target.checked?[...scope.unitIds,u.id]:scope.unitIds.filter(x=>x!==u.id));onChange({...scope,...next,startPage:scope.startPage,endPage:scope.endPage,startKnowledge:scope.startKnowledge,pageRanges:scope.pageRanges,excludedPages:scope.excludedPages,detail:scope.detail});if(u.start)setWindowStart(Math.floor((u.start-1)/35)*35+1);}}/><span>{catalog&&unitPath(catalog,u.id)}<small>{u.start?'p.'+u.start+(u.end?'~'+u.end:' · 끝 미확인'):'쪽수 미등록'}</small></span></label>)}</div>{!units.length&&<p className="hint">목차 미등록 · 실제 범위만 선택하세요.</p>}</details>
   <details className="scope-grid"><summary>그리드로 범위·제외 고르기</summary>
    <div className="scope-modes" aria-label="쪽수 선택 방식">{(['range','append','exclude'] as const).map(v=><button type="button" key={v} disabled={disabled} aria-pressed={mode===v} onClick={()=>{setMode(v);setAnchor(null);}}>{{range:'범위 선택',append:'다른 구간 추가',exclude:'제외 쪽'}[v]}</button>)}</div>
    <div className="scope-page-nav"><button type="button" aria-label="이전 쪽 번호" disabled={disabled||windowStart<=1} onClick={()=>setWindowStart(Math.max(1,windowStart-35))}>‹</button><span>{windowStart}–{Math.min(last,windowStart+34)}쪽</span><button type="button" aria-label="다음 쪽 번호" disabled={disabled||windowStart+35>last} onClick={()=>setWindowStart(windowStart+35)}>›</button></div>
    <p className="hint" role="status">{mode==='exclude'?'선택 범위에서 뺄 쪽을 누르세요.':anchor===null?'시작 쪽 → 끝 쪽을 누르세요.':anchor+'쪽 선택 중 · 끝 쪽을 누르세요.'}{!book?.end?' 교재 끝 쪽은 미확인입니다.':''}</p>
    <div className="scope-pages" aria-label="페이지 범위 선택">{Array.from({length:35},(_,i)=>windowStart+i).filter(p=>p<=last).map(p=><button type="button" key={p} aria-label={p+'쪽'} aria-pressed={contains(p)&&!scope.excludedPages?.includes(p)} data-excluded={scope.excludedPages?.includes(p)||undefined} data-anchor={anchor===p||undefined} disabled={disabled||mode==='exclude'&&!contains(p)||!!book?.start&&p<book.start} onClick={()=>choosePage(p)}>{p}<small>{scope.excludedPages?.includes(p)?'제외':anchor===p?'시작':''}</small></button>)}</div>
   </details>
   <button type="button" className="quiet" disabled={disabled} onClick={()=>{setAnchor(null);patch({pageRanges:undefined,excludedPages:undefined,startPage:null,endPage:null,startKnowledge:'known'});}}>쪽수 선택 지우기</button>
   <details><summary>범위 원문·시작 미확정·문항 예외</summary><label className="field">공통 범위 원문<input aria-label="공통 범위 원문" value={scope.notation} maxLength={2000} disabled={disabled} onChange={e=>patch({notation:e.target.value})}/></label>
    <label className="checkbox-label"><input type="checkbox" checked={scope.startKnowledge==='unknown'} disabled={disabled||!!scope.pageRanges||scope.startPage!==null} onChange={e=>patch({startKnowledge:e.target.checked?'unknown':'known'})}/>범위 시작은 미확정으로 보존</label>
    <label className="field">실제 문항·예외<input aria-label="실제 문항·예외" value={scope.detail} disabled={disabled} maxLength={2000} onChange={e=>patch({detail:e.target.value})}/></label>
    <p className="hint">{scopeText(scope)}</p>
   </details>
  </>)}
 </div>;
}

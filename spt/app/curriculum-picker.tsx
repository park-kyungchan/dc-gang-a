'use client';
import {useEffect,useRef,useState} from 'react';
import {assignedBooks,assertScopeCurrent,scopeText,scopeDraftFeedback,scopeSchema,type CurriculumCatalog,type CurriculumScope} from '@/lib/curriculum';
import {activityChoices} from '@/lib/classroom';
import {ScopePicker} from './scope-picker';
export type AssignmentDraft={scope:CurriculumScope|null;activities:string[]};
type Props={studentId:string;date:string;initialCatalog?:CurriculumCatalog|null;draft?:AssignmentDraft;retain:(draft:AssignmentDraft)=>Promise<void>;assign:(title:string,scope:CurriculumScope,id:string)=>Promise<void>;fail:(e:unknown)=>void;onDone?:()=>void};
export function CurriculumAssignment(p:Props){
 const [loaded,setLoaded]=useState<{catalog:CurriculumCatalog|null;basedOn?:string}>({catalog:p.initialCatalog||null,basedOn:p.initialCatalog?.revision}),[value,setValue]=useState<AssignmentDraft>(p.draft||{scope:null,activities:[]}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const initialRevision=p.initialCatalog?.revision,catalog=p.initialCatalog&&initialRevision!==loaded.basedOn?p.initialCatalog:loaded.catalog||p.initialCatalog||null;
 const current=useRef(value),retained=useRef(Promise.resolve()),saving=useRef(false),ids=useRef<Record<string,string>>({});
 useEffect(()=>{if(initialRevision)return;let live=true;void fetch('/api/curriculum',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('목차 원본을 다시 읽어 주세요.');return r.json() as Promise<{catalog:CurriculumCatalog|null}>;}).then(v=>{if(live)setLoaded({catalog:v.catalog,basedOn:initialRevision});}).catch(()=>{});return()=>{live=false;};},[initialRevision]);
 function change(next:AssignmentDraft){current.current=next;setValue(next);retained.current=retained.current.catch(()=>{}).then(()=>p.retain(next));void retained.current.catch(p.fail);}
 async function refresh(){setBusy(true);try{const r=await fetch('/api/curriculum',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refresh',date:p.date})});const v=await r.json() as {catalog:CurriculumCatalog|null;error?:string};if(!r.ok||!v.catalog)throw new Error(v.error||'현재 연결에는 목차가 없습니다. 빠른 활동 배정은 그대로 사용할 수 있습니다.');setLoaded({catalog:v.catalog,basedOn:initialRevision});setMessage('원본 목차 확인됨 · 저장된 이전 범위는 자동 변경하지 않습니다.');}catch(e){p.fail(e);}finally{setBusy(false);}}
 const scope=value.scope,books=catalog?assignedBooks(catalog,p.studentId):[];
 const stale=!!scope&&(!catalog||catalog.revision!==scope.catalogRevision),feedback=scopeDraftFeedback(scope);
 async function assign(){
  if(saving.current||!value.scope||!value.activities.length)return;saving.current=true;setBusy(true);const selected={scope:value.scope,activities:[...value.activities]};
  try{const check=scopeDraftFeedback(selected.scope);if(check.kind!=='ready')throw new Error(check.message);scopeSchema.parse(selected.scope);assertScopeCurrent(selected.scope,catalog,p.studentId);await retained.current;
   for(const title of selected.activities){const id=ids.current[title]||(ids.current[title]=crypto.randomUUID());await p.assign(title,selected.scope,id);delete ids.current[title];const next={...current.current,activities:current.current.activities.filter(x=>x!==title)};change(next);await retained.current;}
   setMessage('같은 실제 범위로 배정했습니다. 각 활동의 진행·완료·확인은 따로 표시합니다.');p.onDone?.();
  }catch(e){p.fail(e);}finally{saving.current=false;setBusy(false);}
 }
 return <details className="curriculum-assignment"><summary>교재·목차로 활동 묶음 배정</summary><div className="curriculum-body">
  <p className="hint">{p.date} · 선택 범위는 배정일 뿐 전체 수행·숙달이 아닙니다.</p>
  <div className="button-row"><button disabled={busy} onClick={()=>void refresh()}>목차 원본 새로 읽기</button>{catalog&&<small>원본 교재 {books.length}권</small>}</div>
  {!catalog&&<p role="status">목차 원본 확인 전 · 아래 빠른 활동 배정은 사용할 수 있습니다.</p>}
  <ScopePicker studentId={p.studentId} catalog={catalog} scope={scope} onChange={scope=>change({...value,scope})} disabled={busy}/>
  {scope&&<>
  <fieldset disabled={busy}><legend>이 공통 범위에 배정할 활동</legend><button type="button" onClick={()=>change({...value,activities:['개념백지테스트','클리닉','DT']})}>개념백지·Clinic·DT 묶음 선택</button><div className="curriculum-activities">{activityChoices().map(title=><label className="checkbox-label" key={title}><input type="checkbox" checked={value.activities.includes(title)} onChange={e=>change({...value,activities:e.target.checked?[...value.activities,title]:value.activities.filter(x=>x!==title)})}/>{title==='DT'?'Daily Test':title}</label>)}</div></fieldset>
  <p className="curriculum-preview">{scopeText(scope)}</p><button className="primary" disabled={busy||stale||!value.activities.length||feedback.kind!=='ready'} onClick={()=>void assign()}>{busy?'보관 중…':`공통 범위로 ${value.activities.length}개 활동 배정`}</button></>}
  {message&&<p role="status">{message}</p>}
 </div></details>;
}

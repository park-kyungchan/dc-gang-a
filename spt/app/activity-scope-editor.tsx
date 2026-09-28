'use client';
import {useEffect,useRef,useState} from 'react';
import {applyActivityScope,type ActivityScopeDraft} from '@/lib/activity-scope';
import {scopeText,scopeDraftFeedback,type CurriculumCatalog} from '@/lib/curriculum';
import {taskLabels,type ClassEvent,type Task} from '@/lib/classroom';
import {ScopePicker} from './scope-picker';
import {havrutaLabel} from '@/lib/havruta';

type Props={event:ClassEvent;studentId:string;date:string;catalog?:CurriculumCatalog|null;draft?:ActivityScopeDraft;retain:(draft:ActivityScopeDraft|null)=>Promise<void>;onApply:(draft:ActivityScopeDraft,catalog:CurriculumCatalog)=>Promise<void>;onDone:()=>void;fail:(error:unknown)=>void};
export function ActivityScopeEditor(p:Props){
 const original=JSON.parse(p.event.body) as Task;
 const [value,setValue]=useState<ActivityScopeDraft>(()=>p.draft||{activityId:p.event.entity_id,baseRevisionId:p.event.id,scope:original.scope||null});
 const [loaded,setLoaded]=useState<{catalog:CurriculumCatalog|null;basedOn?:string}>({catalog:p.catalog||null,basedOn:p.catalog?.revision}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const valueRef=useRef(value),retained=useRef(Promise.resolve()),saving=useRef(false);
 const currentRevision=p.catalog?.revision,catalog=currentRevision&&currentRevision!==loaded.basedOn?p.catalog!:loaded.catalog||p.catalog||null;
 const stale=value.baseRevisionId!==p.event.id,unavailable=original.cancelled||original.workDate!==p.date;
 useEffect(()=>{if(currentRevision)return;let live=true;void fetch('/api/curriculum',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('목차 원본을 확인하지 못했습니다.');return r.json() as Promise<{catalog:CurriculumCatalog|null}>;}).then(v=>{if(live)setLoaded({catalog:v.catalog});}).catch(e=>{if(live)setError(e instanceof Error?e.message:'목차 확인 전');});return()=>{live=false;};},[currentRevision]);
 function retain(next:ActivityScopeDraft|null){retained.current=retained.current.catch(()=>{}).then(()=>p.retain(next));void retained.current.catch(e=>{setError(e instanceof Error?e.message:'선택 보관을 확인하지 못했습니다.');p.fail(e);});return retained.current;}
 function change(patch:Partial<ActivityScopeDraft>){const next={...valueRef.current,...patch};valueRef.current=next;setValue(next);setError('');void retain(next);}
 async function refresh(){setBusy(true);setError('');try{const r=await fetch('/api/curriculum',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refresh',date:p.date})});const v=await r.json() as {catalog:CurriculumCatalog|null;error?:string};if(!r.ok||!v.catalog)throw new Error(v.error||'원본 목차를 확인하지 못했습니다.');setLoaded({catalog:v.catalog,basedOn:currentRevision});}catch(e){setError(e instanceof Error?e.message:'목차 확인 전');}finally{setBusy(false);}}
 const feedback=scopeDraftFeedback(value.scope);
 let valid=false,validationMessage=feedback.message;try{applyActivityScope(p.event,value,p.studentId,p.date,catalog);valid=true;}catch(e){validationMessage=e instanceof Error?e.message:'선택 범위를 확인하세요.';}
 async function apply(){
  if(saving.current||!catalog||!valid||stale||unavailable)return;saving.current=true;setBusy(true);setError('');
  try{await retained.current;await p.onApply(valueRef.current,catalog);await retain(null);p.onDone();}
  catch(e){setError(e instanceof Error?e.message:'보관 결과를 확인하지 못했습니다. 선택은 유지됩니다.');p.fail(e);}
  finally{saving.current=false;setBusy(false);}
 }
 async function discard(){setBusy(true);try{await retained.current;await retain(null);p.onDone();}catch(e){setError(e instanceof Error?e.message:'수정안 보관 상태를 확인하세요.');p.fail(e);}finally{setBusy(false);}}
 return <section className="activity-scope-editor" aria-label="이 활동의 배정 범위">
  <div className="scope-activity-context"><strong>{original.title} · {original.havruta?havrutaLabel(original):taskLabels[original.state]}</strong><small>원수업 {p.event.class_date}{p.event.class_date!==p.date?' · 현재 배정 '+p.date:''}</small><p>현재 배정: {original.range||'범위 미기록'}</p></div>
  <p className="hint">배정 범위만 바꿉니다. 시작 시각·진행 상태·실제 수행·채점·교사 확인 내역은 그대로 보존하며 새 완료를 뜻하지 않습니다.</p>
  {unavailable&&<p role="alert">이동하거나 취소된 활동입니다. 선택은 보존됩니다. 원래 활동을 먼저 확인하세요.</p>}
  {stale&&<div className="scope-conflict" role="alert"><strong>다른 활동 수정이 도착했습니다.</strong><p>내 선택: {value.scope?scopeText(value.scope):'범위 선택 전'}</p><p>위 현재 배정과 비교하세요. 최신 상태를 보지 않은 채 덮어쓰지 않습니다.</p><button type="button" disabled={busy||!!unavailable} onClick={()=>change({baseRevisionId:p.event.id})}>현재 활동을 확인하고 내 범위 유지</button></div>}
  <button type="button" disabled={busy} onClick={()=>void refresh()}>목차 원본 새로 읽기</button>
  <ScopePicker studentId={p.studentId} catalog={catalog} scope={value.scope} recentScopes={original.scope?[original.scope]:[]} showFeedback={false} onChange={scope=>change({scope})} disabled={busy||!!unavailable}/>
  <div className="scope-editor-actions">
   {!stale&&!unavailable&&<p role={!valid&&feedback.kind!=='incomplete'?'alert':'status'} data-scope-state={valid?'ready':feedback.kind==='incomplete'?'incomplete':'invalid'}>{valid?feedback.message:validationMessage}</p>}
   <button type="button" className="primary" disabled={busy||!valid||stale||!!unavailable} onClick={()=>void apply()}>{busy?'기기 보관 중…':'이 활동에 범위 적용'}</button><button type="button" disabled={busy} onClick={()=>void discard()}>이번 범위 수정안 버리기</button>
  </div>
  <p className="hint">닫으면 선택을 보관합니다. 적용 전에는 활동·숙제를 변경하지 않습니다. 적용한 범위는 기존 활동의 수정 이력에 남습니다.</p>
  {error&&<p role="alert">{error}</p>}
 </section>;
}

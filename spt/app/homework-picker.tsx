'use client';
import {useRef,useState} from 'react';
import {ScopePicker} from './scope-picker';
import {catalogFromSnapshot,scopeSchema,scopeText,scopeDraftFeedback,assertScopeCurrent} from '@/lib/curriculum';
import {blankCloseout,entity,values,activityChoices,type Closeout,type ClassEvent} from '@/lib/classroom';
import {defaultHomeworkActions,homeworkPlanSchema,homeworkText,nextHomeworkDue,type HomeworkDraft} from '@/lib/homework';
import {validDate,type Student} from '@/lib/notebook';
import type {RevisionMode} from '@/lib/outbox';

type Save=(kind:string,id:string,data:unknown,date?:string,baseId?:string,mode?:RevisionMode)=>Promise<void>;
type Props={student:Student;date:string;ledger:ClassEvent[];snapshot?:unknown;save:Save;fail:(e:unknown)=>void;closeout?:Closeout;onSave?:(next:Closeout)=>Promise<void>;onDone?:()=>void};
export function HomeworkPanel(p:Props){
 const event=p.ledger.find(e=>e.entity_id===entity('closeout',p.student.id,p.date)),close=p.closeout||values(event,blankCloseout);
 const planEvent=p.ledger.find(e=>e.entity_id===entity('plan',p.student.id,p.date));
 const initial=values(planEvent,{homeworkDraft:undefined as HomeworkDraft|undefined}).homeworkDraft;
 const [snapshot,setSnapshot]=useState(p.snapshot),[draft,setDraft]=useState<HomeworkDraft>(()=>initial||{items:close.homeworkPlan?.items||[],due:close.due,noHomework:close.noHomework,scope:null,actions:[]});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const editing=draft.editingId||null;
 const current=useRef(draft),retained=useRef(Promise.resolve()),saving=useRef(false),base=useRef(event?.id||'');
 const observed=snapshot||p.snapshot,catalog=catalogFromSnapshot(observed),next=nextHomeworkDue(p.student,p.date,observed),due=draft.due||next.date||'';
 function change(patch:Partial<HomeworkDraft>){const value={...current.current,...patch};current.current=value;setDraft(value);retained.current=retained.current.catch(()=>{}).then(()=>p.save('plan',entity('plan',p.student.id,p.date),{...values(planEvent,{titles:activityChoices()}),homeworkDraft:value},p.date,planEvent?.id||'','draft'));void retained.current.catch(p.fail);}
 async function refresh(){setBusy(true);try{const r=await fetch('/api/sheet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'preview',date:p.date})});const v=await r.json() as {snapshot?:unknown;error?:string};if(!r.ok||!v.snapshot)throw new Error(v.error||'원본 일정·교재를 확인하지 못했습니다. 기존 입력은 보존합니다.');setSnapshot(v.snapshot);setMessage('원본 일정·보강·교재 확인됨. 이미 정한 기한은 바꾸지 않습니다.');}catch(e){p.fail(e);}finally{setBusy(false);}}
 function add(){try{if(!draft.scope||!draft.actions.length)return;const feedback=scopeDraftFeedback(draft.scope);if(feedback.kind!=='ready')throw new Error(feedback.message);const scope=scopeSchema.parse(draft.scope);assertScopeCurrent(scope,catalog,p.student.id);const item={id:editing||crypto.randomUUID(),scope,actions:draft.actions};const items=editing?draft.items.map(i=>i.id===editing?item:i):[...draft.items,item];homeworkPlanSchema.parse({items});change({items,noHomework:false,scope:null,actions:[],editingId:null});}catch(e){p.fail(e);}}
 async function save(){
  if(saving.current)return;saving.current=true;setBusy(true);
  try{const homeworkPlan=homeworkPlanSchema.parse({items:draft.noHomework?[]:draft.items});if(!draft.noHomework&&(!validDate(due)||due<p.date||!homeworkPlan.items.length))throw new Error('할 일과 정확한 기한을 확인하세요.');for(const item of homeworkPlan.items)assertScopeCurrent(item.scope,catalog,p.student.id);await retained.current;
   const updated:Closeout={...close,homeworkPlan,homework:homeworkText(homeworkPlan),due:draft.noHomework?'':due,noHomework:draft.noHomework,confirmed:false,parentInput:undefined,...(close.diary?{diary:{...close.diary,homework:''}}:{})};
   if(p.onSave)await p.onSave(updated);else await p.save('closeout',entity('closeout',p.student.id,p.date),updated,p.date,base.current,'event');
   change({due:updated.due});await retained.current;setMessage('숙제 배정 보관 · 일지 확정과 학원 DB 반영은 별도입니다.');p.onDone?.();
  }catch(e){p.fail(e);}finally{saving.current=false;setBusy(false);}
 }
 const validScope=scopeDraftFeedback(draft.scope).kind==='ready';
 return <section className="homework-picker" aria-label={p.student.name+' 다음 수업 숙제'}>
  <div className="homework-due"><strong>다음 수업 숙제</strong><span>{due||'날짜 확인 전'} · {draft.due?'저장·직접 지정한 기한':next.reason}</span><small>{next.readAt?'일정 원본 확인 '+new Date(next.readAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'자동 날짜 추정 안 함'}</small></div>
  <button type="button" disabled={busy} onClick={()=>void refresh()}>일정·교재 원본 새로 읽기</button>
  <label className="field">숙제 기한<input aria-label="숙제 기한" type="date" min={p.date} value={due} disabled={busy||draft.noHomework} onChange={e=>change({due:e.target.value})}/></label>
  {!draft.noHomework&&due&&(!validDate(due)||due<p.date)&&<p role="alert">숙제 기한의 연·월·일을 확인하세요. 대상 수업일보다 이전 날짜는 저장하지 않습니다.</p>}
  {draft.due&&next.date&&draft.due!==next.date&&<button type="button" disabled={busy} onClick={()=>change({due:next.date!})}>다음 등록 수업일 {next.date}로 변경</button>}
  <label className="checkbox-label"><input type="checkbox" checked={draft.noHomework} disabled={busy} onChange={e=>change({noHomework:e.target.checked})}/>다음 수업 전 숙제 없음</label>
  {!draft.noHomework&&<>
   {close.homework&&!close.homeworkPlan&&<details><summary>기존 숙제 원문 · 새 선택으로 저장 전까지 유지</summary><pre>{close.homework}</pre></details>}
   <div className="homework-items">{draft.items.map(i=><article key={i.id}><p>{scopeText(i.scope)}<br/><b>{i.actions.join('·')}</b></p><div><button type="button" disabled={busy} onClick={()=>change({editingId:i.id,scope:i.scope,actions:i.actions})}>범위 수정</button><button type="button" disabled={busy} onClick={()=>{if(editing===i.id)change({items:draft.items.filter(x=>x.id!==i.id),scope:null,actions:[],editingId:null});else change({items:draft.items.filter(x=>x.id!==i.id)});}}>항목 빼기</button></div></article>)}</div>
   <ScopePicker key={editing||'new'} studentId={p.student.id} catalog={catalog} scope={draft.scope} disabled={busy} onChange={scope=>change({scope,...(!scope?{editingId:null}:{}),actions:scope?.bookId!==draft.scope?.bookId?defaultHomeworkActions(scope?.bookLabel||''):draft.actions})}/>
   {editing&&<button type="button" disabled={busy} onClick={()=>change({editingId:null,scope:null,actions:[]})}>이번 범위 수정 취소</button>}
   {draft.scope&&<><fieldset disabled={busy}><legend>이 범위에서 할 일</legend><div className="homework-actions">{[...new Set(['개념 예습','예습영상 촬영','문제 풀이','오답 재확인',...draft.actions])].map(action=><button type="button" key={action} aria-pressed={draft.actions.includes(action)} onClick={()=>change({actions:draft.actions.includes(action)?draft.actions.filter(x=>x!==action):[...draft.actions,action]})}>{action}</button>)}</div></fieldset><button type="button" disabled={busy||!validScope||!draft.actions.length} onClick={add}>{editing?'범위 수정 반영':'숙제 목록에 추가'}</button></>}
  </>}
  <div className="homework-save"><button type="button" className="primary" disabled={busy||!draft.noHomework&&(!!draft.scope||!draft.items.length||!validDate(due)||due<p.date)} onClick={()=>void save()}>{busy?'보관 중…':'숙제 배정 저장'}</button><p className="hint">선택 중인 범위는 목록에 추가하세요. 숙제 안내·귀가·교사 최종 확정은 자동 표시하지 않습니다.</p></div>
  {message&&<p role="status">{message}</p>}
 </section>;
}

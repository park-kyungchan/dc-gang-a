'use client';
import {useEffect,useRef,useState} from 'react';
type Fields={progress:string;homework:string;class_memo:string};
type Receipt={entryId?:string;requestId?:string;studentId?:string;date?:string;state:string;before?:{name:string;course:string;sourceRef:string;fields:Fields};desired?:Fields;changedFields?:string[];error?:string};
const labels:Record<string,string>={prepared:'원본 대조 완료 · 입력 전',verified:'학원 DB 정확 재조회 확인',already_equal:'기존 원본과 같음 · 새 입력 없음',unknown:'입력 결과 불명확 · 재조회 필요',partial:'일부 처리 후 중지 · 재조회 필요',conflict:'원본 변경 · 입력 중지',changed_after_verification:'확인 이후 원본 변경됨',not_applied:'이 수정본의 학원 입력 확인 전',applying:'처리 중 · 다시 입력하지 마세요'};
export function AcademyPanel({studentId,date,entryId,ready}:{studentId:string;date:string;entryId?:string;ready:boolean}){
 const [receipt,setReceipt]=useState<Receipt|null>(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[configured,setConfigured]=useState<boolean|null>(null);
 const inFlight=useRef(false),generation=useRef(0);
 // The parent keys this controller by student/date/immutable review revision.
 useEffect(()=>{const n=++generation.current;void fetch('/api/academy',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json() as Promise<{configured:boolean}>;}).then(v=>{if(n===generation.current)setConfigured(v.configured);}).catch(()=>{if(n===generation.current)setConfigured(false);});return()=>{generation.current=n+1;};},[studentId,date,entryId]);
 async function act(action:'preview'|'apply'|'status'){
  if(inFlight.current||!entryId||action!=='status'&&!ready||action==='apply'&&(!checked||receipt?.state!=='prepared'))return;
  inFlight.current=true;setBusy(true);const n=generation.current,id=entryId;
  try{const r=await fetch('/api/academy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,entryId:id,studentId,date,...(action!=='preview'&&receipt?.requestId?{requestId:receipt.requestId}:{})}),signal:AbortSignal.timeout(190000)});const v=await r.json() as Receipt;if(!r.ok)throw new Error(v.error||'학원 입력 연결을 확인해 주세요.');if(n===generation.current){setReceipt(v);setChecked(false);setMessage('');}}
  catch(e){if(n===generation.current){setMessage(e instanceof Error?e.message:'결과를 확인하지 못했습니다.');if(action==='apply')setReceipt(r=>r?{...r,state:'unknown'}:r);}}
  finally{inFlight.current=false;if(n===generation.current)setBusy(false);}
 }
 return <section className="academy-panel" aria-label="검토한 학원 일지 입력"><h3>학원 DB 입력</h3><p>{date} · 학생 {studentId}</p><p className="hint">Sheet 저장과 별개입니다. 학부모 공개 문안을 대조한 뒤 입력하며, 리포트 저장·일괄발송은 선생님이 직접 합니다.</p>
  {configured===false&&<p role="status">학원 연결 확인 필요 · 보관된 입력은 유지됩니다.</p>}
  {!ready&&<p className="hint">학원 공개 진도·숙제를 먼저 검토·확정하고 서버 보관을 확인하세요.</p>}
  <div className="button-row"><button disabled={busy||!ready||configured===false} onClick={()=>void act('preview')}>학원 원본과 대조</button><button disabled={busy||!entryId||configured===false} onClick={()=>void act('status')}>학원 입력 결과 재조회</button></div>
  {receipt&&<><p className="academy-status" role="status">{labels[receipt.state]||'결과 확인 필요'}</p>{receipt.before&&receipt.desired&&<><p><b>{receipt.before.name} · {receipt.before.course}</b><br/>학원 원본 {receipt.before.sourceRef}</p><div className="academy-comparison"><section><h4>현재 학원 원본</h4>{(['progress','homework','class_memo'] as const).map(k=><div key={k}><b>{{progress:'진도',homework:'숙제',class_memo:'메모'}[k]}</b><pre>{receipt.before!.fields[k]||'(비어 있음)'}</pre></div>)}</section><section><h4>검토한 입력 내용</h4>{(['progress','homework','class_memo'] as const).map(k=><div key={k}><b>{{progress:'진도',homework:'숙제',class_memo:'메모'}[k]} · {receipt.changedFields?.includes(k)?'변경':'유지'}</b><pre>{receipt.desired![k]||'(비어 있음)'}</pre></div>)}</section></div></>}
  {receipt.state==='prepared'&&<><label className="checkbox-label"><input type="checkbox" checked={checked} disabled={busy||!ready||receipt.entryId!==entryId} onChange={e=>setChecked(e.target.checked)}/>학생·수업일·학부모 공개 문안과 원본 변경 항목을 대조했습니다.</label><button className="primary" disabled={busy||!ready||!checked||receipt.entryId!==entryId} onClick={()=>void act('apply')}>검토한 항목만 학원 DB에 입력</button></>}
  {receipt.state==='verified'&&<p>학원 입력 확인됨 · 학생별 스터디 리포트 저장과 발송은 별도입니다.</p>}</>}
  {message&&<p role="alert" className="academy-status">{message}</p>}
  <p className="hint">출결·DT 측정값·지속사항은 바꾸지 않습니다. 비어 있는 공개 메모는 기존 메모를 유지합니다. 결과가 불명확하면 재입력 전에 재조회하세요.</p><a href="https://dc.gang-a.kr" target="_blank" rel="noreferrer">학원 사이트 열기</a>
 </section>;
}

'use client';
import type {NotebookData} from '@/lib/projection';
import {isTest} from '@/lib/classroom';

type Props = {
 data:NotebookData; studentId:string; date:string; name:string;
 selectedId:string; tests:boolean; serverSessionIds:string[];
 state:'loading'|'error'|'offline'|'ready';
 onSelect:(id:string)=>void; onTests:(value:boolean)=>void; onRefresh:()=>void;
};
function recordedTime(value:string){
 const time=new Date(value);
 return Number.isFinite(time.getTime())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(time):'시각 미확인';
}

/** A view over existing records, never a recording target or another store. */
export function ConversationList(p:Props){
 const all=p.data.sessions.filter(s=>s.student_id===p.studentId&&s.class_date===p.date);
 const visible=all.filter(s=>p.tests||!isTest(s)).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
 const hidden=p.tests?0:all.filter(isTest).length;
 const selected=visible.some(s=>s.id===p.selectedId);
 const serverIds=new Set(p.serverSessionIds);
 return <section className="panel conversation-list" aria-label="보관한 대화">
  <div className="section-title"><h3>보관한 대화 <span>{visible.length}건</span></h3><button type="button" onClick={()=>p.onSelect('')}>새 대화</button></div>
  <p className="hint">{p.name} · {p.date} · 목록 선택은 녹음 대상을 바꾸지 않습니다.</p>
  {p.state==='loading'&&<p role="status">서버 기록 확인 중 · 기기에서 확인한 기록을 먼저 표시합니다.</p>}
  {p.state==='error'&&<div role="alert"><p>서버 기록을 확인하지 못했습니다. 아래 기기 기록은 유지하며, 기록이 없다고 판단하지 않습니다.</p><button type="button" onClick={p.onRefresh}>기록 다시 확인</button></div>}
  {p.state==='offline'&&<p role="status">인터넷 연결 끊김 · 기기에서 확인한 기록입니다. 다른 기기의 기록은 연결 후 확인하세요.</p>}
  {hidden>0&&<p className="notice">테스트 대화 {hidden}건이 숨겨져 있습니다. <button type="button" onClick={()=>p.onTests(true)}>테스트 {hidden}건 보기</button></p>}
  <label className="conversation-test-filter"><input type="checkbox" checked={p.tests} onChange={e=>p.onTests(e.target.checked)}/>테스트 기록 보기 (수업 정리에서 제외)</label>
  {!!p.selectedId&&!selected&&<p className="notice" role="status">선택한 대화가 현재 학생·날짜·필터에 없습니다. 아래 기록을 선택하거나 새 대화를 준비하세요.</p>}
  {!p.selectedId&&visible.length>0&&<p className="hint" role="status">아직 대화를 선택하지 않았습니다. 아래 기록을 누르면 원음과 전사를 확인할 수 있습니다.</p>}
  {!visible.length&&<p className="empty-small">{p.state==='ready'?(hidden?'현재 필터에 표시할 수업 대화가 없습니다.':'이 학생의 이 수업일에 보관한 대화가 없습니다.'):'현재 기기에서 표시할 대화가 없습니다. 서버 기록은 아직 확인되지 않았습니다.'}</p>}
  <div className="conversation-records">{visible.map(s=>{
   const captures=p.data.captures.filter(c=>c.session_id===s.id);
   const transcripts=p.data.events.filter(e=>e.session_id===s.id&&e.kind==='transcript').length;
   const retention=serverIds.has(s.id)?p.state==='ready'?'서버 확인됨':'이전 서버 확인 · 재확인 필요':'기기 보관 · 서버 확인 전';
   return <button type="button" key={s.id} data-session-id={s.id} aria-pressed={p.selectedId===s.id} onClick={()=>p.onSelect(s.id)}>
    <strong>{isTest(s)?'[테스트] ':''}{recordedTime(s.created_at)} · {s.title}</strong>
    <span>{retention} · {s.ended_at?'마친 대화':'열린 대화'}</span>
    <span>녹음 연결 {captures.length}건 · 전사 {transcripts}구간 · 대화 {s.id.slice(0,8)}</span>
   </button>;
  })}</div>
 </section>;
}

'use client';
import {Check,ChevronRight,AlertCircle} from 'lucide-react';
import type {Student} from '@/lib/notebook';
import {blankCloseout,classPart,classTime,classStatus,entity,isOpen,taskLabels,values,type ClassEvent,type Task} from '@/lib/classroom';
import {ActivityClock,useClassClock} from './activity-clock';
import {revisitDue} from '@/lib/activity-time';
import {closeoutCurrent,closeoutEvidenceBasis,type CloseoutEvidence} from '@/lib/closeout-review';

/** Same information hierarchy in the class list and the temporary work picker. */
export function StudentRoster({students,date,ledger,evidence,selected,onChoose,recordingId='',recordingState='',presentation='list'}:{students:Student[];date:string;ledger:ClassEvent[];evidence?:CloseoutEvidence;selected:string;onChoose:(id:string)=>void;recordingId?:string;recordingState?:string;presentation?:'list'|'field'}){
 const now=useClassClock();
 return <div className={'student-list '+(presentation==='field'?'field-students':'')}>{students.map(s=>{
  const tasks=ledger.filter(e=>e.student_id===s.id&&e.kind==='activity').map(e=>JSON.parse(e.body) as Task).filter(t=>t.workDate===date&&!t.cancelled);
  const open=tasks.filter(isOpen),needs=tasks.filter(t=>t.state==='check'||t.state==='student_done'||!!t.unresolved),due=open.some(t=>revisitDue(t.timing,now));
  const close=values(ledger.find(e=>e.entity_id===entity('closeout',s.id,date)),blankCloseout),facts=classStatus(ledger,s.id,date);
  const confirmed=evidence?closeoutCurrent(close,closeoutEvidenceBasis(s.id,date,evidence)):close.confirmed&&!close.evidenceBasis;
  return <button type="button" className={'student-card '+(selected===s.id?'selected ':'')+(needs.length||due?'needs-visit':'')} key={s.id} onClick={()=>onChoose(s.id)} aria-pressed={selected===s.id}>
   <span className="student-card-top"><strong id={presentation==='field'?'field-student-'+s.id:undefined}>{s.name}</strong><span>{s.active===false?'예정 제외':classPart(s.id,date,students)}{presentation==='field'&&<span className="field-student-time">{classTime(s.id,date,students)}</span>}</span></span>
   <span className="student-activity">{open.length?(presentation==='field'?open.slice(0,2):open).map((t,i)=><span className="roster-activity-line" key={i}>{presentation==='field'&&<span className="field-task-lane">{t.lane==='teacher'?'강사 진행·확인':'학생 활동'}</span>}<span className="roster-task-name">{t.title}<span className="roster-task-state"> · {taskLabels[t.state]}</span></span>{t.range&&<span className="roster-range">{t.range}</span>}<ActivityClock timing={t.timing}/></span>):<span className="roster-unassigned">{tasks.length?(tasks.every(t=>t.state==='done')?'활동 확인 마침':'진행 중 활동 없음'):'활동 배정 전'}</span>}{presentation==='field'&&open.length>2&&<span className="field-more-tasks">외 {open.length-2}개 활동</span>}
    <span className="student-badges">{needs.length>0&&<span className="status-tag attention"><AlertCircle size={14}/>{needs.length}건 확인</span>}{due&&<span className="status-tag attention">재방문</span>}{facts.departedAt&&<span className="status-tag complete"><Check size={14}/>귀가</span>}{confirmed?<span className="status-tag complete"><Check size={14}/>진도·숙제 확정</span>:<span className="roster-closeout">{close.confirmed?'근거 재확인':'상세 정리 전'}</span>}{recordingId===s.id&&<span className="status-tag recording-tag">{recordingState}</span>}</span>
   </span><ChevronRight size={16} className="roster-chevron" aria-hidden="true"/>
  </button>;
 })}</div>;
}

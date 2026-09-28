import {Check} from 'lucide-react';
import {retentionLabels,reflectionLabels,type ClassroomView} from '@/lib/classroom-view';

/** One shared explanation of record state, beside its actual consumer action. */
export function RecordProgress({view,onTracker}:{view:ClassroomView;onTracker?:()=>void}){
 const steps=[
  {name:'앱 보관',state:view.retention,done:view.retention==='server',label:retentionLabels[view.retention]},
  {name:'교사 확정',state:view.confirmation,done:view.confirmation==='confirmed',label:view.confirmationLabel},
  {name:'원본 반영',state:view.reflection,done:view.reflection==='reflected',label:reflectionLabels[view.reflection]},
 ];
 return <div className="record-progress" aria-label="이 학생의 기록 단계" role="status"><ol>{steps.map((s,i)=><li key={s.name} data-stage={s.state}><span className={'record-step '+(s.done?'is-complete':'')}>{s.done?<Check size={13}/>:i+1}</span><span><strong>{s.name}</strong><small>{s.label}</small></span></li>)}</ol>{view.originalObservedAt&&<p className="record-observed">원본 조회 기준 · {new Date(view.originalObservedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</p>}{onTracker&&<button className="record-next" onClick={onTracker}>이 학생 원본 저장·대조 <span aria-hidden="true">→</span></button>}</div>;
}

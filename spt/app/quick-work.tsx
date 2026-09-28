'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowLeft,UsersRound} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import {Activities} from './classroom-panels';
import {StudentRoster} from './student-roster';
import type {Student} from '@/lib/notebook';
import type {ClassEvent} from '@/lib/classroom';
import type {CloseoutEvidence} from '@/lib/closeout-review';
import type {RevisionMode} from '@/lib/outbox';

type Save=(studentId:string,kind:string,id:string,value:unknown,origin?:string,base?:string,mode?:RevisionMode)=>Promise<void>;
/** A temporary action surface: the original record is never replaced or unmounted. */
export function QuickWork({current,date,students,ledger,evidence,save,ready}:{current:Student;date:string;students:Student[];ledger:ClassEvent[];evidence?:CloseoutEvidence;save:Save;ready:boolean}){
 const [open,setOpen]=useState(false),[id,setId]=useState(''),[error,setError]=useState('');
 const trigger=useRef<HTMLButtonElement>(null),scroll=useRef(0),body=useRef<HTMLDivElement>(null);
 const [viewport,setViewport]=useState<{height:number;bottom:number}|null>(null);
 useEffect(()=>{if(!open)return;const resize=()=>{const v=window.visualViewport;setViewport({height:v?.height||window.innerHeight,bottom:Math.max(0,window.innerHeight-(v?.height||window.innerHeight)-(v?.offsetTop||0))});};resize();window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);return()=>{window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize);};},[open]);
 const chosen=students.find(s=>s.id===id);
 function openChange(value:boolean){if(value){scroll.current=window.scrollY;setId('');setError('');}setOpen(value);}
 return <Dialog open={open} onOpenChange={openChange}><DialogTrigger asChild><button ref={trigger} className="quick-work-trigger" disabled={!ready}><UsersRound size={17}/>다른 학생 잠깐</button></DialogTrigger>
 <DialogContent style={viewport?{'--available-height':viewport.height+'px','--keyboard-bottom':viewport.bottom+'px'} as CSSProperties:undefined} className="quick-work-dialog top-0 left-0 translate-x-0 translate-y-0" showCloseButton={false} onCloseAutoFocus={e=>{e.preventDefault();window.scrollTo({top:scroll.current,behavior:'instant'});trigger.current?.focus({preventScroll:true});}}>
  <DialogHeader><DialogTitle>{chosen?chosen.name+' · 잠깐 배정·확인':'잠깐 처리할 학생'}</DialogTitle><DialogDescription>{current.name} 기록은 펼쳐 둔 그대로 유지됩니다.</DialogDescription></DialogHeader>
  <div className="quick-work-scroll" ref={body}>{error&&<p role="alert" className="error">{error}</p>}{chosen?<><button className="quiet" onClick={()=>{setId('');setError('');body.current?.scrollTo({top:0});}}><ArrowLeft size={16}/>학생 다시 선택</button><Activities key={id+date} studentId={id} date={date} ledger={ledger} save={(kind,entity,value,origin,base,mode)=>save(id,kind,entity,value,origin,base,mode)} fail={e=>setError(e instanceof Error?e.message:'보관하지 못했습니다. 다시 확인해 주세요.')} compact/></>:<StudentRoster students={students.filter(s=>s.id!==current.id)} selected="" date={date} ledger={ledger} evidence={evidence} onChoose={next=>{setId(next);body.current?.scrollTo({top:0});}}/>}</div>
  <div className="quick-work-return"><button className="primary" onClick={()=>setOpen(false)}><ArrowLeft size={18}/>{current.name} 기록으로 복귀</button></div>
 </DialogContent></Dialog>;
}

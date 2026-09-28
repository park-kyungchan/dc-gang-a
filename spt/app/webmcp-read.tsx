'use client';
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {findModelContext,registerSptTools,type LessonSnapshot,type StudentDoneInput,type ToolResult} from '@/lib/webmcp';
const subscribeCapability=()=>()=>{};
const readCapability=()=>!!findModelContext(globalThis as Parameters<typeof findModelContext>[0]);

/** Per-page explicit consent. Production stays read-only; synthetic state enables one typed write. */
export function WebMCPRead({snapshot,label,markCurrentActivityStudentDone}:{snapshot:LessonSnapshot;label:string;markCurrentActivityStudentDone:(input:StudentDoneInput)=>Promise<ToolResult>}){
 const latest=useRef(snapshot),write=useRef(markCurrentActivityStudentDone),registration=useRef<AbortController|null>(null);
 const available=useSyncExternalStore(subscribeCapability,readCapability,()=>false);
 const [enabled,setEnabled]=useState(false),[notice,setNotice]=useState(''),[reads,setReads]=useState(0),[writes,setWrites]=useState(0);
 useLayoutEffect(()=>{latest.current=snapshot;write.current=markCurrentActivityStudentDone;});
 useEffect(()=>{
  if(!enabled)return;
  const native=findModelContext(globalThis as Parameters<typeof findModelContext>[0]);
  if(!native)return;
  const controller=new AbortController();registration.current=controller;
  void registerSptTools(native.api,()=>latest.current,{markCurrentActivityStudentDone:input=>write.current(input)},()=>{
   setReads(n=>n+1);setNotice('조회 완료 · '+new Date().toLocaleTimeString('ko-KR'));
  },result=>{
   if(result.ok)setWrites(n=>n+1);setNotice((result.ok?'합성 활동 기록 완료':'기록 거부 · '+String(result.code||'확인 필요'))+' · '+new Date().toLocaleTimeString('ko-KR'));
  },controller.signal).then(()=>{if(!controller.signal.aborted)setNotice(latest.current.synthetic?'합성 환경 조회·학생 마침 도구 준비됨':'읽기 전용 도구 준비됨');}).catch(()=>{if(!controller.signal.aborted){controller.abort();setNotice('도구 등록 실패 · 일반 수업 기능은 유지됩니다');}});
  return ()=>{controller.abort();if(registration.current===controller)registration.current=null;};
 },[enabled]);
 if(!available)return null;
 return <aside className="sync-strip" aria-label="WebMCP 도구 권한"><label><input type="checkbox" checked={enabled} onChange={e=>{
  if(!e.target.checked){registration.current?.abort();setNotice('도구 허용 꺼짐');}setEnabled(e.target.checked);
 }}/><span>에이전트 도구 허용 · {label} · {snapshot.date}{snapshot.synthetic?' · 합성 기록만':''}</span></label><span role="status" aria-live="polite">{notice||'허용 전에는 도구를 제공하지 않습니다'}{reads>0?' · 조회 '+reads+'회':''}{writes>0?' · 기록 '+writes+'회':''}</span></aside>;
}
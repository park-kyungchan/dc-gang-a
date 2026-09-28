'use client';
import {useState} from 'react';
import {validDate} from '@/lib/notebook';

export function DatasetPanel({date,pending,online}:{date:string;pending:number;online:boolean}){
 const [from,setFrom]=useState(date),[to,setTo]=useState(date);
 const valid=validDate(from)&&validDate(to)&&from<=to&&(Date.parse(to)-Date.parse(from))/86400000<=30;
 const path=(view:string)=>'/api/dataset?'+new URLSearchParams({from,to,view});
 return <details className="panel dataset-panel"><summary>데이터 보관·재사용</summary>
  <p>이 앱에 보관된 기록을 학생·대화·활동 ID와 함께 내려받습니다. 원음은 대화별 원문·음성에서 별도로 받을 수 있습니다.</p>
  <div className="field-grid"><label className="field">시작 수업일<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="field">종료 수업일<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
  <p className="hint">한 번에 31일 · 현재 로그인한 교사의 서버 보관 기록 · 테스트 제외. Sheet 연결 후 가져온 원본 스냅샷과 마감 연동 이력도 포함됩니다.</p>
  {pending>0&&<p className="notice">이 기기에 미전송 기록 {pending}건이 있습니다. 이 파일에는 서버에 보관된 내용만 들어갑니다.</p>}
  {!online&&<p className="notice">인터넷에 연결하면 내려받을 수 있습니다. 기기에 보관한 내용은 유지됩니다.</p>}
  {!valid&&<p className="notice">내보낼 수업일을 31일 이내로 선택해 주세요.</p>}
  {valid&&online&&<div className="button-row"><a href={path('current')} download>현재 기록 내려받기 (.jsonl)</a><a href={path('history')} download>수정·삭제 이력까지 보관 (.jsonl)</a></div>}
  <p className="hint">현재 기록은 삭제된 관찰과 이전 수정본을 제외합니다. 이력 보관 파일에는 삭제·수정 전 내용도 들어가므로 현재 학습 결과와 구분해 사용하세요. 교사 확인 표시가 있어도 실제 학부모 전송을 증명하지 않습니다.</p>
 </details>;
}

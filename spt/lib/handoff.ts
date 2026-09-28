import {students,validDate,type Student} from './notebook';
import {blankCloseout,completeCloseout,entity,signature,values,type ClassEvent} from './classroom';
import {assertDiaryReady} from './diary-draft';

/** A deliberate, teacher-reviewed transfer. No conversation, audio or AI fields. */
export function trackerHandoff(studentId:string,date:string,ledger:ClassEvent[],roster:Student[]=students,testMode=false,rehearsal=false){
 const kind=testMode?'closeout_test':'closeout',student=roster.find(s=>s.id===studentId),record=ledger.find(e=>e.entity_id===entity(kind,studentId,date));
 const close=values(record,blankCloseout);
 if(!student||!validDate(date)||!record||record.student_id!==studentId||record.class_date!==date||record.kind!==kind||(close.test===true)!==testMode||!close.confirmed||!completeCloseout(close))throw new Error('실제 진도와 다음 숙제 범위·기한을 먼저 확정해 주세요.');
 if(!close.noHomework&&close.due<date)throw new Error('다음 숙제 기한이 수업일보다 앞섭니다. 날짜를 확인해 주세요.');
 const transferTest=testMode||rehearsal;
 if(close.diary)assertDiaryReady(close.diary);
 const closeout={...(transferTest?{test:true}:{}),progress:close.progress,homework:close.noHomework?'':close.homework,due:close.noHomework?'':close.due,noHomework:close.noHomework,next:close.next,confirmed:true,departedAt:close.departedAt,...(close.diary?{diary:close.diary}:{})};
 return JSON.stringify({protocol:'spt-classroom-handoff',schema:1,source:'notebook',test:transferTest,studentId,studentName:student.name,date,sourceId:record.id,sourceSignature:signature(JSON.stringify(closeout)),closeout},null,2);
}

export function notebookDestination(search:string,roster:Student[]=students){
 const q=new URLSearchParams(search),student=q.get('student'),date=q.get('date'),view=q.get('view');
 if(!roster.some(s=>s.id===student)||!validDate(date))return null;
 return {studentId:student!,date,view:['class','record','review'].includes(view||'')?view!:'class'};
}

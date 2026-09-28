import {classroomView,retentionOf} from './classroom-view';
import {havrutaState,havrutaStatePatch} from './havruta';
import {validDate,uuid} from './notebook';
import type {Task} from './classroom';
import type {NotebookData} from './projection';

export const TOOL_NAME='spt_current_lesson';
export const STUDENT_DONE_TOOL_NAME='spt_mark_current_activity_student_done';
export type LessonSnapshot={studentId:string;date:string;knownStudent:boolean;synthetic:boolean;ready:boolean;online:boolean;serverIssue:boolean;syncedAt:string;data:NotebookData};
type ModelTool={name:string;description:string;inputSchema:Record<string,unknown>;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:unknown,options?:{signal?:AbortSignal})=>Promise<unknown>};
export type ModelContext={registerTool:(tool:ModelTool,options:{signal:AbortSignal})=>void|Promise<void>};
type Environment={isSecureContext?:boolean;document?:{modelContext?:ModelContext};navigator?:{modelContext?:ModelContext}};
export type StudentDoneInput={expectedRevisionId:string};
export type StudentDoneCommand={studentId:string;date:string;entityId:string;expectedRevisionId:string;next:Task};
export type StudentDoneWriter=(command:StudentDoneCommand)=>Promise<{revisionId:string;snapshot:LessonSnapshot}>;
export type ToolResult=Record<string,unknown>&{ok:boolean;schema:string;code?:string};
const rejected=(code:string)=>({ok:false as const,schema:'spt.current-lesson.v1' as const,code});
const writeRejected=(code:string)=>({ok:false as const,schema:'spt.activity-student-done.v1' as const,code});

/** Same read model as the UI, not a new store or a fresh server-verification claim. */
export function readCurrentLesson(snapshot:LessonSnapshot,observedAt=new Date().toISOString()){
 if(!snapshot.ready||!snapshot.knownStudent||!snapshot.studentId||!validDate(snapshot.date))return rejected('CONTEXT_NOT_READY');
 if(snapshot.data.classroomLoaded!==true)return rejected('CLASSROOM_UNAVAILABLE');
 try{
  const view=classroomView(snapshot.studentId,snapshot.date,snapshot.data),current=view.current;
  return {ok:true as const,schema:'spt.current-lesson.v1' as const,
   subject:{studentId:snapshot.studentId,date:snapshot.date},source:'ui_projection' as const,observedAt,
   freshness:!snapshot.online||snapshot.serverIssue||!snapshot.syncedAt?'stale' as const:'last_server_refresh' as const,
   lastServerRefreshAt:snapshot.syncedAt||null,
   counts:{activities:view.activities.length,openWork:view.openWork.length,teacherFollowups:view.followups.length},
   current:current?{entityId:current.event.entity_id,revisionId:current.event.id,title:current.task.title.slice(0,150),
    state:havrutaState(current.task),lane:current.task.lane,workDate:current.task.workDate,
    unresolved:!!current.task.unresolved.trim(),cancelled:current.task.cancelled===true,
    retention:retentionOf(current.event,snapshot.data.localItems),localProjection:current.event.local_projection===true}:null,
   confirmation:view.confirmation};
 }catch{return rejected('CONTEXT_UNREADABLE');}
}

/** One semantic write: student completion, never teacher verification or mastery. */
export async function markCurrentActivityStudentDone(snapshot:LessonSnapshot,input:unknown,write:StudentDoneWriter,observedAt=new Date().toISOString()):Promise<ToolResult>{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!('expectedRevisionId' in input))return writeRejected('ARGUMENTS_INVALID');
 const expectedRevisionId=(input as StudentDoneInput).expectedRevisionId;
 if(typeof expectedRevisionId!=='string'||!uuid(expectedRevisionId))return writeRejected('EXPECTED_REVISION_REQUIRED');
 if(!snapshot.synthetic)return writeRejected('SYNTHETIC_TARGET_REQUIRED');
 const context=readCurrentLesson(snapshot,observedAt);
 if(!context.ok||context.freshness!=='last_server_refresh'||!context.current)return writeRejected(context.ok?'CONTEXT_NOT_FRESH':context.code);
 if(context.current.localProjection||context.current.retention!=='server')return writeRejected('PENDING_LOCAL_WRITE');
 if(context.current.revisionId!==expectedRevisionId)return writeRejected('REVISION_CHANGED');
 let view:ReturnType<typeof classroomView>;
 try{view=classroomView(snapshot.studentId,snapshot.date,snapshot.data);}catch{return writeRejected('CONTEXT_UNREADABLE');}
 const current=view.current;
 if(!current||current.event.id!==expectedRevisionId)return writeRejected('REVISION_CHANGED');
 if(current.task.cancelled)return writeRejected('ACTIVITY_UNAVAILABLE');
 if(havrutaState(current.task)==='student_done')return {ok:true,schema:'spt.activity-student-done.v1',subject:context.subject,entityId:current.event.entity_id,previousRevisionId:current.event.id,revisionId:current.event.id,state:'student_done',teacherVerified:false,alreadyApplied:true,source:'server_readback'};
 const next={...current.task,...havrutaStatePatch(current.task,'student_done',observedAt)};
 try{
  const saved=await write({studentId:snapshot.studentId,date:current.event.class_date,entityId:current.event.entity_id,expectedRevisionId,next});
  if(!saved||typeof saved.revisionId!=='string'||!uuid(saved.revisionId)||!saved.snapshot)return writeRejected('WRITE_NOT_CONFIRMED');
  const readback=readCurrentLesson(saved.snapshot,observedAt);
  if(!readback.ok||!readback.current||readback.current.entityId!==current.event.entity_id||readback.current.revisionId!==saved.revisionId||readback.current.state!=='student_done')return writeRejected('WRITE_NOT_CONFIRMED');
  return {ok:true,schema:'spt.activity-student-done.v1',subject:readback.subject,entityId:current.event.entity_id,previousRevisionId:current.event.id,revisionId:saved.revisionId,state:'student_done',teacherVerified:false,source:'server_readback'};
 }catch{return writeRejected('WRITE_FAILED');}
}

/** Feature detection only. Never polyfill a missing native browser capability. */
export function findModelContext(environment:Environment){
 if(environment.isSecureContext!==true)return null;
 if(typeof environment.document?.modelContext?.registerTool==='function')return {api:environment.document.modelContext,location:'document' as const};
 if(typeof environment.navigator?.modelContext?.registerTool==='function')return {api:environment.navigator.modelContext,location:'navigator' as const};
 return null;
}

export async function registerCurrentLessonTool(api:ModelContext,read:()=>LessonSnapshot,onRead:()=>void,signal:AbortSignal){
 if(signal.aborted)return;
 await api.registerTool({name:TOOL_NAME,
  description:'Read only the currently selected SPT student and lesson date. Returns a bounded UI projection, not a fresh server read or proof of mastery. No record, outbox, Sheet, recording or model writes. The teacher must select and permit the context in the page.',
  inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},
  execute:async(input,options)=>{
   if(signal.aborted||options?.signal?.aborted)return rejected('READ_PERMISSION_REVOKED');
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)return rejected('EMPTY_INPUT_REQUIRED');
   let result:ReturnType<typeof readCurrentLesson>;
   try{result=readCurrentLesson(read());}catch{return rejected('CONTEXT_UNREADABLE');}
   if(signal.aborted||options?.signal?.aborted)return rejected('READ_PERMISSION_REVOKED');
   if(result.ok)onRead();
   return result;
  }
 },{signal});
}

export async function registerSptTools(api:ModelContext,read:()=>LessonSnapshot,actions:{markCurrentActivityStudentDone:(input:StudentDoneInput)=>Promise<ToolResult>},onRead:()=>void,onWrite:(result:ToolResult)=>void,signal:AbortSignal){
 await registerCurrentLessonTool(api,read,onRead,signal);
 if(signal.aborted||!read().synthetic)return;
 await api.registerTool({name:STUDENT_DONE_TOOL_NAME,
  description:'Record the selected current activity as completed by the student in the isolated synthetic SPT environment. This does not verify the teacher check or establish mastery.',
  inputSchema:{type:'object',properties:{expectedRevisionId:{type:'string',format:'uuid',description:'Exact current revisionId returned by spt_current_lesson.'}},required:['expectedRevisionId'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},
  execute:async(input,options)=>{
   if(signal.aborted||options?.signal?.aborted)return writeRejected('WRITE_PERMISSION_REVOKED');
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!('expectedRevisionId' in input))return writeRejected('ARGUMENTS_INVALID');
   const expectedRevisionId=(input as StudentDoneInput).expectedRevisionId;
   if(typeof expectedRevisionId!=='string'||!uuid(expectedRevisionId))return writeRejected('EXPECTED_REVISION_REQUIRED');
   let result:ToolResult;try{result=await actions.markCurrentActivityStudentDone({expectedRevisionId});}catch{return writeRejected('WRITE_FAILED');}
   if(signal.aborted||options?.signal?.aborted)return writeRejected('WRITE_PERMISSION_REVOKED');
   onWrite(result);return result;
  }
 },{signal});
}
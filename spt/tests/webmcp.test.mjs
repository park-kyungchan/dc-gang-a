import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root='.sites-runtime/webmcp-contract-tests';mkdirSync(root,{recursive:true});
await build({entryPoints:['lib/webmcp.ts'],outfile:root+'/webmcp.mjs',bundle:true,platform:'node',format:'esm'});
const {readCurrentLesson,markCurrentActivityStudentDone,registerCurrentLessonTool,registerSptTools,findModelContext,TOOL_NAME,STUDENT_DONE_TOOL_NAME}=await import(pathToFileURL(process.cwd()+'/'+root+'/webmcp.mjs'));
const date='2026-09-22',at='2026-09-22T01:40:00.000Z';
function activity(student='S001',patch={}){return {id:'11111111-1111-4111-8111-111111111111',entity_id:'22222222-2222-4222-8222-222222222222',student_id:student,class_date:date,kind:'activity',created_at:at,body:JSON.stringify({title:'SYNTHETIC lesson',workDate:date,lane:'student',state:'student_done',note:'PRIVATE NOTE MUST NOT LEAK',unresolved:'',...patch})};}
function snapshot(patch={}){return {studentId:'S001',date,ready:true,knownStudent:true,synthetic:true,online:true,serverIssue:false,syncedAt:at,data:{sessions:[],events:[],captures:[],ledger:[activity(),activity('S002',{title:'OTHER STUDENT'})],connected:true,classroomLoaded:true,localItems:[]},...patch};}
function fakeNative(){const tools=new Map();return {tools,api:{registerTool(tool,{signal}){if(signal.aborted)return;tools.set(tool.name,tool);signal.addEventListener('abort',()=>tools.delete(tool.name),{once:true});}}};}

test('one selected lesson reuses domain states without exposing roster, notes or raw bodies',()=>{
 const s=snapshot(),before=structuredClone(s),r=readCurrentLesson(s,at);
 assert.equal(r.ok,true);assert.equal(r.schema,'spt.current-lesson.v1');assert.equal(r.subject.studentId,'S001');assert.equal(r.subject.date,date);
 assert.equal(r.current.state,'student_done');assert.equal(r.current.retention,'server');assert.equal(r.current.revisionId,s.data.ledger[0].id);
 assert.equal(r.counts.activities,1);assert.equal(r.counts.openWork,1);assert.equal(r.source,'ui_projection');assert.equal(r.freshness,'last_server_refresh');
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE NOTE|OTHER STUDENT|S002|"body"|"roster"/);assert.deepEqual(s,before);
 r.subject.studentId='changed';assert.equal(readCurrentLesson(s,at).subject.studentId,'S001');
});
test('unacquired classroom data is unavailable rather than an observed empty lesson',()=>{
 const s=snapshot();s.data.classroomLoaded=false;s.data.ledger=[];
 const r=readCurrentLesson(s,at);assert.equal(r.ok,false);assert.equal(r.code,'CLASSROOM_UNAVAILABLE');assert.equal('counts' in r,false);
 const empty=snapshot();empty.data.ledger=[];assert.equal(readCurrentLesson(empty,at).counts.activities,0);
});
test('invalid and not-yet-selected subjects fail closed without inventing a student',()=>{
 for(const p of [{ready:false},{knownStudent:false},{studentId:''},{date:'2026-02-30'}])assert.equal(readCurrentLesson(snapshot(p),at).ok,false);
});
test('pending local projection and offline data never become a fresh saved result',()=>{
 const s=snapshot({online:false});s.data.ledger[0].local_projection=true;s.data.localItems=[{type:'job',url:'/api/classroom',payload:{id:s.data.ledger[0].id,studentId:'S001',entityId:s.data.ledger[0].entity_id,date},error:'offline'}];
 const r=readCurrentLesson(s,at);assert.equal(r.freshness,'stale');assert.equal(r.current.retention,'blocked');assert.equal(r.current.localProjection,true);
 assert.equal(readCurrentLesson(snapshot({serverIssue:true}),at).freshness,'stale');
});
test('first semantic write marks only the selected current activity as student done with exact server readback',async()=>{
 const s=snapshot(),calls=[];s.data.ledger[0].body=JSON.stringify({...JSON.parse(s.data.ledger[0].body),state:'working'});const before=structuredClone(s);
 const result=await markCurrentActivityStudentDone(s,{expectedRevisionId:s.data.ledger[0].id},async command=>{
  calls.push(command);const revisionId='33333333-3333-4333-8333-333333333333';
  const next=snapshot();next.data.ledger[0]={...next.data.ledger[0],id:revisionId,body:JSON.stringify(command.next)};
  return {revisionId,snapshot:next};
 },at);
 assert.equal(result.ok,true);assert.equal(result.schema,'spt.activity-student-done.v1');assert.equal(result.previousRevisionId,s.data.ledger[0].id);
 assert.equal(result.revisionId,'33333333-3333-4333-8333-333333333333');assert.equal(result.state,'student_done');assert.equal(result.teacherVerified,false);
 assert.equal(calls.length,1);assert.equal(calls[0].studentId,'S001');assert.equal(calls[0].entityId,s.data.ledger[0].entity_id);assert.equal(calls[0].next.state,'student_done');
 assert.equal(calls[0].next.state,'student_done');assert.deepEqual(s,before);
});
test('semantic write rejects production, stale revision, cancelled work and unconfirmed readback',async()=>{
 const s=snapshot();s.data.ledger[0].body=JSON.stringify({...JSON.parse(s.data.ledger[0].body),state:'working'});const revision=s.data.ledger[0].id,writer=async()=>{throw new Error('writer must not run')};
 assert.equal((await markCurrentActivityStudentDone(snapshot({synthetic:false}),{expectedRevisionId:revision},writer,at)).code,'SYNTHETIC_TARGET_REQUIRED');
 assert.equal((await markCurrentActivityStudentDone(s,{expectedRevisionId:'33333333-3333-4333-8333-333333333333'},writer,at)).code,'REVISION_CHANGED');
 const cancelled=snapshot();cancelled.data.ledger[0].body=JSON.stringify({...JSON.parse(cancelled.data.ledger[0].body),cancelled:true});
 assert.equal((await markCurrentActivityStudentDone(cancelled,{expectedRevisionId:revision},writer,at)).code,'ACTIVITY_UNAVAILABLE');
 const unconfirmed=await markCurrentActivityStudentDone(s,{expectedRevisionId:revision},async()=>({revisionId:'33333333-3333-4333-8333-333333333333',snapshot:snapshot()}),at);
 assert.equal(unconfirmed.code,'WRITE_NOT_CONFIRMED');
});
test('malformed stored evidence returns an explicit failure, not an empty success',()=>{
 const s=snapshot();s.data.ledger[0].body='{';assert.equal(readCurrentLesson(s,at).code,'CONTEXT_UNREADABLE');
});
test('unsupported and insecure environments do not add a polyfill or register a tool',()=>{
 const n=fakeNative();assert.equal(findModelContext({isSecureContext:false,navigator:{modelContext:n.api}}),null);
 const env={isSecureContext:true,document:{},navigator:{}};assert.equal(findModelContext(env),null);assert.deepEqual(env,{isSecureContext:true,document:{},navigator:{}});
});
test('current document API is preferred; installed navigator API is an explicit fallback',()=>{
 const a=fakeNative(),b=fakeNative();assert.equal(findModelContext({isSecureContext:true,document:{modelContext:a.api},navigator:{modelContext:b.api}}).location,'document');
 assert.equal(findModelContext({isSecureContext:true,navigator:{modelContext:b.api}}).location,'navigator');
});
test('registration reads the latest selected context, rejects extra inputs and aborts completely',async()=>{
 const n=fakeNative(),controller=new AbortController();let current=snapshot(),reads=0;
 await registerCurrentLessonTool(n.api,()=>current,()=>reads++,controller.signal);
 const tool=n.tools.get(TOOL_NAME);assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.inputSchema.additionalProperties,false);
 assert.equal((await tool.execute({})).subject.studentId,'S001');current=snapshot({studentId:'S002'});assert.equal((await tool.execute({})).subject.studentId,'S002');
 for(const value of [null,[],{studentId:'S003'},{command:'save'},'{}'])assert.equal((await tool.execute(value)).code,'EMPTY_INPUT_REQUIRED');
 assert.equal(reads,2);controller.abort();assert.equal(n.tools.size,0);assert.equal((await tool.execute({})).code,'READ_PERMISSION_REVOKED');
});
test('synthetic registration exposes one typed write while production remains read only',async()=>{
 const n=fakeNative(),controller=new AbortController();let current=snapshot(),writes=0;
 await registerSptTools(n.api,()=>current,{markCurrentActivityStudentDone:async input=>{writes++;return {ok:true,schema:'spt.activity-student-done.v1',revisionId:input.expectedRevisionId};}},()=>{},()=>{},controller.signal);
 assert.deepEqual([...n.tools.keys()].sort(),[STUDENT_DONE_TOOL_NAME,TOOL_NAME].sort());
 const write=n.tools.get(STUDENT_DONE_TOOL_NAME),revision=current.data.ledger[0].id;
 assert.equal(write.annotations.readOnlyHint,false);assert.equal((await write.execute({expectedRevisionId:revision})).ok,true);assert.equal(writes,1);
 assert.equal((await write.execute({})).code,'ARGUMENTS_INVALID');assert.equal((await write.execute({expectedRevisionId:'bad'})).code,'EXPECTED_REVISION_REQUIRED');
 assert.equal((await write.execute({expectedRevisionId:revision,state:'done'})).code,'ARGUMENTS_INVALID');
 controller.abort();assert.equal(n.tools.size,0);
 const production=fakeNative();await registerSptTools(production.api,()=>snapshot({synthetic:false}),{markCurrentActivityStudentDone:async()=>{throw new Error('unreachable')}},()=>{},()=>{},new AbortController().signal);
 assert.deepEqual([...production.tools.keys()],[TOOL_NAME]);
});
test('revocation during a callback cannot publish a successful result',async()=>{
 const n=fakeNative(),controller=new AbortController();let acknowledgements=0;
 await registerCurrentLessonTool(n.api,()=>{controller.abort();return snapshot();},()=>acknowledgements++,controller.signal);
 const result=await n.tools.get(TOOL_NAME).execute({});assert.equal(result.code,'READ_PERMISSION_REVOKED');assert.equal(acknowledgements,0);
});

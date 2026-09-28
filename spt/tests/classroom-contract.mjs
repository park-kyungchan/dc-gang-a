// Adversarial integration checks: isolated SQLite + real route handlers,
// standards-based IndexedDB simulation, and the production AudioWorklet.
import 'fake-indexeddb/auto';
import {api,sql,sign,req,good,test} from './pilot-contract.mjs';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const day='2026-09-09',student='S004';
const revision=(entityId,kind,data,baseId='',studentId=student,date=day)=>({id:randomUUID(),entityId,kind,data,baseId,studentId,date});
const save=p=>api.classroom.POST(req('/api/classroom',p));
let activity;
await test('activity replay, immutable origin and stale edits preserve the full history',async()=>{
 const entityId=randomUUID();activity=revision(entityId,'activity',api.classModel.task('마인드맵 작성',day));await good(await save(activity));await good(await save(activity));assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events WHERE entity_id=?').get(entityId).n,1);
 assert.equal((await save({...activity,data:{...activity.data,title:'conflicting replay'}})).status,409);
 const stale=revision(entityId,'activity',{...activity.data,state:'working'});assert.equal((await save(stale)).status,409);
 const next=revision(entityId,'activity',{...activity.data,workDate:'2026-09-12',state:'pending',unresolved:'오답 2개 재확인'},activity.id);await good(await save(next));
 assert.equal((await save({...next,id:randomUUID(),baseId:next.id,date:'2026-09-12'})).status,409);
 const rows=(await good(await api.classroom.GET(new Request('https://spt.example/api/classroom?entity='+entityId)))).ledger;assert.equal(rows.length,2);assert.equal(rows[1].class_date,day);assert.equal(JSON.parse(rows[1].body).workDate,'2026-09-12');
});
await test('required prerequisite cannot be marked complete without teacher override',async()=>{
 const first=revision(randomUUID(),'activity',api.classModel.task('개념 학습',day));await good(await save(first));
 const next=revision(randomUUID(),'activity',{...api.classModel.task('개념백지테스트',day),prerequisite:first.entityId,relation:'required',state:'done'});assert.equal((await save(next)).status,409);
 await good(await save({...next,data:{...next.data,overrideReason:'직접 구두 설명부터 확인함'}}));
});
await test('classroom instruction and departure are independent facts without a written or confirmed closeout',async()=>{
 const date='2026-09-14',entityId=api.classModel.entity('class_status',student,date),time='2026-09-14T08:10:00.000Z';
 const first=revision(entityId,'class_status',{instructionAt:time,departedAt:''},'',student,date);await good(await save(first));
 const second=revision(entityId,'class_status',{instructionAt:time,departedAt:time},first.id,student,date);await good(await save(second));
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM spt_class_events WHERE student_id=? AND class_date=? AND kind='closeout'").get(student,date).n,0);
 const rows=(await good(await api.classroom.GET(new Request('https://spt.example/api/classroom?entity='+entityId)))).ledger;assert.deepEqual(rows.map(r=>r.id),[first.id,second.id]);
 const corrected=revision(entityId,'class_status',{instructionAt:time,departedAt:''},second.id,student,date);await good(await save(corrected));assert.equal((await save({...corrected,id:randomUUID(),data:{instructionAt:'not-a-time',departedAt:''},baseId:corrected.id})).status,400);
});
await test('student completion is retained without asserting teacher verification or mastery',async()=>{
 const p=revision(randomUUID(),'activity',{...api.classModel.task('SYNTHETIC STUDENT COMPLETION',day),state:'student_done'});await good(await save(p));
 const row=sql.prepare('SELECT body FROM spt_class_events WHERE id=?').get(p.id);assert.equal(JSON.parse(row.body).state,'student_done');assert.equal(api.classModel.isOpen(JSON.parse(row.body)),true);
 assert.equal((await save(revision(api.classModel.entity('closeout',student,'2026-09-15'),'closeout',{...api.classModel.blankCloseout,confirmed:true},'',student,'2026-09-15'))).status,400);
});
await test('legacy departure remains a fact when later detailed text is unconfirmed',async()=>{
 const date='2026-09-16',id=api.classModel.entity('closeout',student,date),time='2026-09-16T08:30:00.000Z';
 const first=revision(id,'closeout',{...api.classModel.blankCloseout,progress:'SYNTHETIC PREVIOUS DETAIL',noHomework:true,confirmed:true,departedAt:time},'',student,date);await good(await save(first));
 const next=revision(id,'closeout',{...first.data,progress:'SYNTHETIC CORRECTION',confirmed:false},first.id,student,date);await good(await save(next));
 const row=sql.prepare('SELECT body FROM spt_class_events WHERE id=?').get(next.id);assert.equal(JSON.parse(row.body).departedAt,time);assert.equal(JSON.parse(row.body).confirmed,false);
});
await test('closeout requires actual progress and explicit homework scope/deadline or no homework',async()=>{
 const id=api.classModel.entity('closeout',student,day);assert.equal((await save(revision(id,'closeout',{...api.classModel.blankCloseout,confirmed:true}))).status,400);
 assert.equal((await save(revision(id,'closeout',{...api.classModel.blankCloseout,progress:'테스트 진도',homework:'범위',due:'2026-02-30',confirmed:true}))).status,400);
 await good(await save(revision(id,'closeout',{...api.classModel.blankCloseout,progress:'테스트 진도',noHomework:true,confirmed:true})));
 sign('teacher-b');assert.equal((await good(await api.classroom.GET(new Request('https://spt.example/api/classroom')))).ledger.length,0);assert.equal((await save({...activity,id:randomUUID(),studentId:'S003',baseId:activity.id})).status,409);sign();
});
await test('test recordings are excluded and mutable local draft content invalidates review',async()=>{
 const s={id:randomUUID(),student_id:student,class_date:day,title:'actual',created_at:new Date().toISOString(),purpose:'lesson'};
 const e={id:randomUUID(),session_id:s.id,kind:'observation',body:JSON.stringify({observed:'initial'}),created_at:s.created_at,capture_id:''};
 const a=api.classModel.reviewBasis(student,day,[],[s],[e]);const b=api.classModel.reviewBasis(student,day,[],[s],[{...e,body:JSON.stringify({observed:'changed, same draft ID'})}]);assert.notEqual(a,b);
 const transcript={...e,session_id:'11111111-1111-4111-8111-111111111111',kind:'transcript',body:JSON.stringify({text:'LEGACY TEST MUST BE EXCLUDED'})};
 const output=api.classModel.exportClass(day,'all',[],[s,{...s,id:transcript.session_id}], [e,transcript],[]);assert.ok(!output.includes('LEGACY TEST MUST BE EXCLUDED'));assert.ok(output.includes('학부모'));
});

let connected=false,uploads=0,failOneAck=false;
const user=await api.server.owner();
globalThis.fetch=async(url,options={})=>{
 if(!connected)throw new TypeError('offline test');
 const path=String(url);if(path==='/api/identity')return api.identity.GET();
 const request=new Request('https://spt.example'+path,{...options,headers:{...options.headers,origin:'https://spt.example'}});
 let response;if(path.startsWith('/api/audio')){uploads++;response=await api.audio.POST(request);}else if(path==='/api/notebook')response=await api.notebook.POST(request);else if(path==='/api/capture')response=await api.capture.POST(request);else if(path==='/api/classroom')response=await api.classroom.POST(request);else throw new Error('unexpected endpoint');
 if(failOneAck&&path.startsWith('/api/audio')&&response.ok){failOneAck=false;throw new TypeError('ack lost after server saved bytes');}return response;
};
const box=new api.DeviceOutbox(user),sid=randomUUID(),cid=randomUUID();await box.read();
const create={action:'create',id:sid,studentId:student,date:day,title:'OFFLINE TEST ONLY',purpose:'test'};
await test('offline start, observations and each received audio frame survive a new app instance',async()=>{
 await box.enqueue(sid,'/api/notebook',create);await box.beginCapture({id:cid,sessionId:sid,studentId:student,date:day});
 await box.audio(cid,0,Uint8Array.from([1,2,3,4]),false,2/16000);
 const p={action:'entry',id:randomUUID(),sessionId:sid,kind:'observation',baseId:'',date:day,data:{observed:'남아야 할 입력',studentSaid:'',next:''}};await box.revision('/api/notebook',p,'entry:'+sid+':observation');await box.flush();
 const reopened=new api.DeviceOutbox(user);await reopened.read();assert.equal(reopened.pending.filter(x=>x.type==='audioDraft').length,1);assert.ok(reopened.pending.some(x=>x.payload?.data?.observed==='남아야 할 입력'));assert.deepEqual(await reopened.readAudio(user+'/audio-'+cid+'-0'),Uint8Array.from([1,2,3,4]));
 assert.ok(reopened.items.every(x=>!x.bytes),'roster refresh must never load the cumulative audio bytes');
 const now=Date.now;Date.now=()=>now()+20000;await reopened.recover();Date.now=now;assert.equal(reopened.items.some(x=>x.type==='active'),false);assert.ok(reopened.pending.some(x=>x.payload?.action==='end'&&x.payload.id===cid));
 connected=true;failOneAck=true;await reopened.flush();assert.ok(reopened.pending.some(x=>x.audioSize),'lost acknowledgement retains audio');await reopened.flush();await reopened.flush();assert.equal(reopened.pending.length,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_audio_chunks WHERE capture_id=?').get(cid).n,1);assert.equal(sql.prepare('SELECT state FROM spt_captures WHERE id=?').get(cid).state,'interrupted');assert.ok(uploads>=2);
});
await test('different account cannot upload another account device buffer',async()=>{
 const x=new api.DeviceOutbox(user);await x.read();const id=randomUUID();await x.enqueue(id,'/api/notebook',{...create,id});sign('teacher-b');await x.flush();assert.ok(x.pending.some(j=>j.payload?.id===id));assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_sessions WHERE id=?').get(id).n,0);sign();await x.flush();
});
await test('two tabs keep distinct drafts and stale changes require explicit conflict resolution',async()=>{
 const a=new api.DeviceOutbox(user),b=new api.DeviceOutbox(user);await a.read();await b.read();const entityId=randomUUID(),initial=api.classModel.task('DT',day);const p=revision(entityId,'activity',initial);await good(await save(p));
 await a.revision('/api/classroom',revision(entityId,'activity',{...initial,note:'tab A'},p.id),'class:'+entityId);
 await b.revision('/api/classroom',revision(entityId,'activity',{...initial,note:'tab B'},p.id),'class:'+entityId);
 await a.read();assert.equal(a.items.filter(j=>j.type==='draft'&&j.scope==='class:'+entityId).length,2);
 await a.flush();assert.equal(a.pending.filter(j=>j.code===409&&j.payload.entityId===entityId).length,1);
 const blocked=a.pending.find(j=>j.code===409&&j.payload.entityId===entityId);const server=sql.prepare('SELECT id FROM spt_class_events WHERE entity_id=? ORDER BY rowid DESC LIMIT 1').get(entityId);await a.rebase(blocked.key,server.id);await a.flush();assert.equal(a.pending.filter(j=>j.payload?.entityId===entityId).length,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events WHERE entity_id=?').get(entityId).n,3);
});
await test('rapid explicit classroom events retain every revision, input time and predecessor across reload',async()=>{
 connected=false;const local=new api.DeviceOutbox(user);await local.read();const entityId=randomUUID(),initial=api.classModel.task('SYNTHETIC EVENT SEQUENCE',day),states=['assigned','working','check'];
 const inputs=states.map((state,i)=>({...revision(entityId,'activity',{...initial,state}),recordedAtClient:`2026-09-12T00:00:00.00${i}Z`}));
 for(const p of inputs)await local.revision('/api/classroom',p,'class:'+entityId,'event');
 const reopened=new api.DeviceOutbox(user);await reopened.read();const pending=reopened.pending.filter(j=>j.payload?.entityId===entityId);
 assert.deepEqual(pending.map(j=>j.payload.data.state),states,'each teacher action must survive, not only the final draft');
 assert.deepEqual(pending.map(j=>j.payload.id),inputs.map(p=>p.id));
 assert.deepEqual(pending.map(j=>j.payload.baseId),['',inputs[0].id,inputs[1].id]);
 assert.deepEqual(pending.map(j=>j.payload.recordedAtClient),inputs.map(p=>p.recordedAtClient));
 connected=true;await reopened.flush();const rows=(await good(await api.classroom.GET(new Request('https://spt.example/api/classroom?entity='+entityId)))).ledger;
 assert.deepEqual(rows.map(r=>JSON.parse(r.body).state),states);assert.deepEqual(rows.map(r=>r.id),inputs.map(p=>p.id));
 assert.deepEqual(rows.map(r=>r.base_revision_id),['',inputs[0].id,inputs[1].id]);assert.ok(rows.every(r=>r.student_id===student&&r.class_date===day));
});
await test('text edits still coalesce, but the latest text draft is sealed before a distinct event',async()=>{
 connected=false;const local=new api.DeviceOutbox(user);await local.read();const entityId=randomUUID(),scope='class:'+entityId,initial=api.classModel.task('SYNTHETIC TEXT AND EVENTS',day);
 const first=revision(entityId,'activity',initial);await local.revision('/api/classroom',first,scope,'event');
 const text=revision(entityId,'activity',{...initial,note:'partial'});await local.revision('/api/classroom',text,scope);
 await local.revision('/api/classroom',revision(entityId,'activity',{...initial,note:'complete draft'}),scope);
 const next=revision(entityId,'activity',{...initial,note:'complete draft',state:'working'});await local.revision('/api/classroom',next,scope,'event');
 const pending=local.pending.filter(j=>j.payload?.entityId===entityId);assert.deepEqual(pending.map(j=>j.payload.id),[first.id,text.id,next.id]);
 assert.deepEqual(pending.map(j=>j.payload.baseId),['',first.id,text.id]);assert.equal(pending[1].payload.data.note,'complete draft');assert.ok(pending.every(j=>j.type==='job'));
 connected=true;await local.flush();const rows=sql.prepare('SELECT id,body FROM spt_class_events WHERE entity_id=? ORDER BY rowid').all(entityId);assert.equal(rows.length,3);assert.equal(JSON.parse(rows[1].body).note,'complete draft');
});
await test('lost event acknowledgement retries the same request without duplicate classroom history',async()=>{
 connected=false;const local=new api.DeviceOutbox(user);await local.read();const entityId=randomUUID(),initial=api.classModel.task('SYNTHETIC LOST EVENT ACK',day),inputs=['assigned','working','check'].map(state=>revision(entityId,'activity',{...initial,state}));
 for(const p of inputs)await local.revision('/api/classroom',p,'class:'+entityId,'event');
 const transport=globalThis.fetch;let lose=true;connected=true;globalThis.fetch=async(url,options)=>{const response=await transport(url,options);if(url==='/api/classroom'&&JSON.parse(options.body).entityId===entityId&&response.ok&&lose){lose=false;throw new TypeError('synthetic acknowledgement lost after commit');}return response;};
 try{await local.flush();assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events WHERE entity_id=?').get(entityId).n,1);assert.ok(local.pending.some(j=>j.payload?.id===inputs[0].id));await local.flush();}
 finally{globalThis.fetch=transport;}
 const rows=sql.prepare('SELECT id,body FROM spt_class_events WHERE entity_id=? ORDER BY rowid').all(entityId);assert.deepEqual(rows.map(r=>r.id),inputs.map(p=>p.id));assert.deepEqual(rows.map(r=>JSON.parse(r.body).state),['assigned','working','check']);
});
await test('a stale event and its dependent successor stay recoverable without overwriting another writer',async()=>{
 const local=new api.DeviceOutbox(user);await local.read();const entityId=randomUUID(),initial=api.classModel.task('SYNTHETIC EVENT CONFLICT',day),first=revision(entityId,'activity',initial);await good(await save(first));
 const a=revision(entityId,'activity',{...initial,state:'working'},first.id),b=revision(entityId,'activity',{...initial,state:'check'},first.id);
 await local.revision('/api/classroom',a,'class:'+entityId,'event');await local.revision('/api/classroom',b,'class:'+entityId,'event');
 const other=revision(entityId,'activity',{...initial,state:'pending',note:'newer writer'},first.id);await good(await save(other));await local.flush();
 const pending=local.pending.filter(j=>j.payload?.entityId===entityId);assert.equal(pending.length,2);assert.equal(pending.find(j=>j.payload.id===a.id).code,409);assert.equal(pending.find(j=>j.payload.id===b.id).payload.baseId,a.id);
 const rows=sql.prepare('SELECT id FROM spt_class_events WHERE entity_id=? ORDER BY rowid').all(entityId);assert.deepEqual(rows.map(r=>r.id),[first.id,other.id]);
});
await test('acknowledged local events bridge a stale view without replacing a fresh external base',async()=>{
 connected=true;const local=new api.DeviceOutbox(user);await local.read();const entityId=randomUUID(),scope='class:'+entityId,initial=api.classModel.task('SYNTHETIC ACK BEFORE RENDER',day);
 const first=revision(entityId,'activity',initial);await local.revision('/api/classroom',first,scope,'event');await local.flush();
 const second=revision(entityId,'activity',{...initial,state:'working'});await local.revision('/api/classroom',second,scope,'event');await local.flush();
 const other=revision(entityId,'activity',{...initial,state:'check'},second.id);await good(await save(other));
 const next=revision(entityId,'activity',{...initial,state:'pending'},other.id);const queued=await local.revision('/api/classroom',next,scope,'event');assert.equal(queued.baseId,other.id);await local.flush();
 const rows=sql.prepare('SELECT id FROM spt_class_events WHERE entity_id=? ORDER BY rowid').all(entityId);assert.deepEqual(rows.map(r=>r.id),[first.id,second.id,other.id,next.id]);
});
await test('an already retained event ID cannot overwrite its pending action',async()=>{
 connected=false;const local=new api.DeviceOutbox(user);await local.read();const entityId=randomUUID(),p=revision(entityId,'activity',api.classModel.task('SYNTHETIC UNIQUE EVENT ID',day));
 await local.revision('/api/classroom',p,'class:'+entityId,'event');await assert.rejects(local.revision('/api/classroom',{...p,data:{...p.data,state:'working'}},'class:'+entityId,'event'),/동작 ID/);
 assert.equal(local.pending.find(j=>j.payload?.id===p.id).payload.data.state,'assigned');connected=true;await local.flush();
});
await test('ending is idempotent and a finished conversation cannot receive a new capture',async()=>{
 const sid=randomUUID();await good(await api.notebook.POST(req('/api/notebook',{...create,id:sid})));await good(await api.notebook.POST(req('/api/notebook',{action:'end',id:sid})));const before=sql.prepare('SELECT ended_at FROM spt_sessions WHERE id=?').get(sid).ended_at;await good(await api.notebook.POST(req('/api/notebook',{action:'end',id:sid})));assert.equal(sql.prepare('SELECT ended_at FROM spt_sessions WHERE id=?').get(sid).ended_at,before);assert.equal((await api.capture.POST(req('/api/capture',{action:'start',id:randomUUID(),sessionId:sid}))).status,409);
});
await test('worklet pause discards intervening sound and resumes without changing the conversation',async()=>{
 let Processor;const messages=[];const context={sampleRate:48000,AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>messages.push(x),onmessage:null};}},registerProcessor:(_,c)=>Processor=c};vm.createContext(context);vm.runInContext(readFileSync('public/pcm-worklet.js','utf8'),context);const p=new Processor();const frame=new Float32Array(4800).fill(.25);p.process([[frame]]);p.port.onmessage({data:{command:'pause',ack:'pause'}});const first=messages.filter(x=>x.pcm).reduce((n,x)=>n+x.pcm.byteLength,0);p.process([[frame]]);p.port.onmessage({data:{command:'flush',ack:'flush'}});assert.equal(messages.filter(x=>x.pcm).reduce((n,x)=>n+x.pcm.byteLength,0),first);p.port.onmessage({data:{command:'resume',ack:'resume'}});p.process([[frame]]);p.flush();assert.equal(messages.filter(x=>x.pcm).reduce((n,x)=>n+x.pcm.byteLength,0),first*2);assert.ok(messages.some(x=>x.ack==='pause'));
});
console.log('Classroom, recovery and conflict checks completed. No live student data or provider calls used.');
await test('microphone becomes ready without a transcription token and storage failure stops honestly',async()=>{
 const workletState={};class FakeNode{constructor(){workletState.current=this;this.port={onmessage:null,postMessage:p=>{queueMicrotask(()=>this.port.onmessage?.({data:{ack:p.ack}}));}};}connect(){}}
 class FakeContext{state='suspended';audioWorklet={addModule:async()=>{}};async resume(){this.state='running'}async close(){this.state='closed';this.onstatechange?.()}createMediaStreamSource(){return {connect(){setTimeout(()=>workletState.current.port.onmessage({data:{pcm:Uint8Array.from([1,2,3,4]).buffer,level:.1}}),5);}}}createGain(){return {gain:{value:1},connect(){}}}}
 globalThis.AudioContext=FakeContext;globalThis.AudioWorkletNode=FakeNode;globalThis.window={AudioWorkletNode:FakeNode};globalThis.WebSocket={OPEN:1};Object.defineProperty(globalThis,'navigator',{value:{onLine:true,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}],getAudioTracks:()=>[{}]})}},configurable:true});
 const outbox=new api.DeviceOutbox(user);await outbox.read();const sid=randomUUID(),cid=randomUUID();await outbox.enqueue(sid,'/api/notebook',{...create,id:sid});await outbox.beginCapture({id:cid,sessionId:sid,studentId:student,date:day});let state;const rec=new api.ClassRecorder(cid,{status:s=>state=s,partial(){},entry(){}},outbox);await rec.prepare();await rec.start(()=>new Promise(()=>{}));assert.equal(state.phase,'recording');assert.equal(state.transcribing,false);await rec.pause();assert.equal(state.phase,'paused');await rec.resume();assert.equal(state.phase,'recording');
 outbox.audio=async()=>{throw new DOMException('quota','QuotaExceededError');};workletState.current.port.onmessage({data:{pcm:Uint8Array.from([5,6]).buffer,level:.1}});await new Promise(r=>setTimeout(r,30));assert.equal(state.phase,'interrupted');assert.ok(rec.emergency?.length);assert.equal(rec.isRecording,false);
});

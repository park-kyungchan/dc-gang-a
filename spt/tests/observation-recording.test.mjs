// Isolated SQLite, IndexedDB and microphone fixtures; never touches the live Site.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {indexedDB} from 'fake-indexeddb';
import {api,sql,sign,req,good} from './pilot-contract.mjs';
globalThis.indexedDB=indexedDB;
const bundle=await build({stdin:{contents:"export * from './lib/observation-cards';export * from './lib/dock-position'",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const model=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
sign();const owner=await api.server.owner(),day='2026-09-09',student='S004';
const create=(id,studentId=student)=>({action:'create',id,studentId,date:day,title:'LOCAL SYNTHETIC TEST',purpose:'lesson'});
const post=p=>api.notebook.POST(req('/api/notebook',p));
const card=(sid,extra={})=>{const cardId=randomUUID();return {action:'entry',id:randomUUID(),sessionId:sid,studentId:student,date:day,kind:model.cardKind(cardId),baseId:'',captureId:'',data:{cardId,category:'observed',text:'LOCAL OBSERVATION',scene:{id:'synthetic-activity',activity:'가상 활동',range:'가상 1–2'},deleted:false,occurrenceOf:'',positionSeconds:null},...extra};};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

await test('same scene shows existing card; changed range, student scene and explicit reobservation remain distinct',()=>{
 const c=card(randomUUID()).data;
 assert.equal(model.sameObservation(c,'observed',' LOCAL OBSERVATION ',c.scene),true);
 for(const scene of [{...c.scene,range:'가상 3–4'},{...c.scene,id:'another-activity'}])assert.equal(model.sameObservation(c,'observed',c.text,scene),false);
 assert.equal(model.sameObservation({...c,deleted:true},'observed',c.text,c.scene),false);
 assert.equal(model.sameObservation(c,'studentSaid',c.text,c.scene),false);
});

await test('concurrent identical deliveries succeed once; card, student and original audio cannot be reassigned',async()=>{
 const sid=randomUUID(),other=randomUUID(),cid=randomUUID();await good(await post(create(sid)));await good(await post(create(other,'S003')));
 await good(await api.capture.POST(req('/api/capture',{action:'start',id:cid,sessionId:sid})));
 const p=card(sid,{captureId:cid});p.data.positionSeconds=1.25;
 const deliveries=await Promise.all([post(p),post(p)]);for(const r of deliveries)await good(r);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_entries WHERE id=?').get(p.id).n,1);
 for(const patch of [{sessionId:other,studentId:'S003',captureId:'',data:{...p.data,positionSeconds:null}},{studentId:'S003'},{date:'2026-09-10'}])assert.equal((await post({...p,id:randomUUID(),...patch})).status,409);
 assert.equal((await post({...p,captureId:'',data:{...p.data,positionSeconds:null}})).status,409);
 assert.equal((await post({...p,id:randomUUID(),baseId:p.id,data:{...p.data,positionSeconds:3}})).status,409);
});

await test('delete/edit collision preserves history, never resurrects a deleted card and removes its text from review export',async()=>{
 const sid=randomUUID();await good(await post(create(sid)));const p=card(sid);await good(await post(p));
 let removed={...p,id:randomUUID(),baseId:p.id,data:{...p.data,deleted:true}};const edited={...p,id:randomUUID(),baseId:p.id,data:{...p.data,text:'STALE EDIT'}};
 const results=await Promise.all([post(removed),post(edited)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 if(results[0].status===409){removed={...removed,id:randomUUID(),baseId:edited.id};await good(await post(removed));}
 assert.equal((await post({...edited,id:randomUUID(),baseId:removed.id})).status,409);for(const response of await Promise.all([post(removed),post(removed)]))await good(response);
 await good(await post(p)); // A lost original acknowledgement is harmless.
 const state=await good(await api.notebook.GET(new Request('https://spt.example/api/notebook?date='+day)));
 const rows=state.events.filter(e=>e.session_id===sid),latest=model.cardRevisions(rows);
 assert.equal(latest.length,1);assert.equal(latest[0].card.deleted,true);
 assert.equal(model.cardRevisions([...rows,rows[0]])[0].card.deleted,true);
 const exported=api.model.exportDay(day,state.sessions.filter(s=>s.id===sid),rows,[]);
 assert(!exported.includes('LOCAL OBSERVATION'));assert(!exported.includes('STALE EDIT'));assert(exported.includes('삭제된 관찰'));
});

await test('an edit-winning deletion correction retries its exact new request, not the rejected base',async()=>{
 const sid=randomUUID();await good(await post(create(sid)));const p=card(sid);await good(await post(p));
 const edited={...p,id:randomUUID(),baseId:p.id,data:{...p.data,text:'SYNTHETIC NEWER EDIT'}};await good(await post(edited));
 const removed={...p,id:randomUUID(),baseId:p.id,data:{...p.data,deleted:true}};assert.equal((await post(removed)).status,409);
 const corrected={...removed,id:randomUUID(),baseId:edited.id};await good(await post(corrected));await good(await post(corrected));
 assert.equal((await post({...corrected,baseId:p.id})).status,409);
});

await test('offline cards and typed drafts survive reopening; conflicting draft is also durable',async()=>{
 const a=new api.DeviceOutbox(owner),b=new api.DeviceOutbox(owner);await a.read();await b.read();
 const scope=day+':draft-fixture',draft={text:'첫 창에서 쓴 글',category:'observed',scene:{id:'free',activity:'활동 외 관찰',range:''}};
 const rev=await a.saveNoteDraft(scope,draft,'');
 await assert.rejects(b.saveNoteDraft(scope,{...draft,text:'다른 창에서 쓴 글'},''));
 const reopened=new api.DeviceOutbox(owner);await reopened.read();assert.equal(reopened.noteDraft(scope).text,draft.text);assert.equal(reopened.recoveredNotes(scope)[0].value.text,'다른 창에서 쓴 글');
 const sid=randomUUID(),p=card(sid);await a.enqueue(sid,'/api/notebook',create(sid));await a.appendCard(p);await a.appendCard(p);
 await reopened.read();assert.equal(reopened.pending.filter(j=>j.payload?.id===p.id).length,1);
 // A newer typed draft must survive saving an older observation card.
 await a.saveNoteDraft(scope,{...draft,text:'저장 중 새로 쓴 글'},rev);await a.appendCard(card(sid));
 await reopened.read();assert.equal(reopened.noteDraft(scope).text,'저장 중 새로 쓴 글');
 assert(reopened.pending.some(j=>j.payload?.id===p.id));
});

await test('card receipt stays visible until the same entry appears in a server read',async()=>{
 const box=new api.DeviceOutbox(owner);await box.read();const sid=randomUUID(),p=card(sid);await box.enqueue(sid,'/api/notebook',create(sid));await box.appendCard(p);
 const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url)==='/api/identity')return new Response(JSON.stringify({ownerKey:owner}));if(String(url)==='/api/notebook')return post(JSON.parse(init.body));throw new Error('No external calls allowed');};
 try{await box.flush();assert(box.items.some(j=>j.type==='receipt'&&j.payload?.id===p.id));await box.reconcile(Date.now()+1,[sid],[]);assert(box.items.some(j=>j.payload?.id===p.id));await box.reconcile(Date.now()+2,[sid],[p.id]);assert(!box.items.some(j=>j.payload?.id===p.id));}finally{globalThis.fetch=original;}
});

await test('edge position moves continuously on either side and stays reachable after viewport shrink',()=>{
 let p={side:'right',ratio:.65};p=model.movedPosition(p,20,145,24,390,12,740);assert.equal(p.side,'left');assert.equal(p.ratio,(145-24-12)/728);
 p=model.movedPosition(p,370,673,24,390,12,740);assert.equal(p.side,'right');assert.equal(p.ratio,(673-24-12)/728);
 assert.equal(model.movedPosition(p,370,-200,24,390,12,280).ratio,0);
 assert.equal(model.movedPosition(p,370,800,24,390,12,280).ratio,1);
 assert.equal(model.movedPosition(p,195,150,24,390,12,280).side,'right');
});

await test('keeping a server deletion archives the conflicting input without resending or losing it',async()=>{
 const sid=randomUUID();await good(await post(create(sid)));const p=card(sid);await good(await post(p));await good(await post({...p,id:randomUUID(),baseId:p.id,data:{...p.data,deleted:true}}));
 const box=new api.DeviceOutbox(owner);await box.read();const stale={...p,id:randomUUID(),baseId:p.id,data:{...p.data,text:'남겨야 할 충돌 입력'}};await box.appendCard(stale);
 const original=globalThis.fetch;let sent=0;globalThis.fetch=async(url,init)=>{if(String(url)==='/api/identity')return new Response(JSON.stringify({ownerKey:owner}));if(String(url)==='/api/notebook'){sent++;return post(JSON.parse(init.body));}throw new Error('No external calls allowed');};
 try{await box.flush();const item=box.items.find(x=>x.payload?.id===stale.id);assert.equal(item.code,409);await box.archiveConflict(item.key);const count=sent;await box.flush();assert.equal(sent,count);const reopened=new api.DeviceOutbox(owner);await reopened.read();assert(reopened.items.some(x=>x.type==='conflictArchive'&&x.payload?.data?.text==='남겨야 할 충돌 입력'));assert(!reopened.pending.some(x=>x.payload?.id===stale.id));}finally{globalThis.fetch=original;}
});

await test('one microphone stops before handoff, late transcription belongs to its original student, and storage failure can recover',async()=>{
 let live=0,maxLive=0,ack=true,quota=false;const sockets=[],nodeState={};
 class FakeNode{constructor(){nodeState.current=this;this.port={onmessage:null,postMessage:p=>{if(ack)queueMicrotask(()=>this.port.onmessage?.({data:{ack:p.ack}}));}};}connect(){}}
 class FakeContext{state='suspended';audioWorklet={addModule:async()=>{}};async resume(){this.state='running';}async close(){this.state='closed';this.onstatechange?.();}createMediaStreamSource(){return {connect:()=>{const own=nodeState.current;queueMicrotask(()=>own.port.onmessage?.({data:{pcm:new Uint8Array([1,2,3,4]).buffer,level:.1}}));}};}createGain(){return {gain:{value:1},connect(){}};}}
 class FakeSocket{static OPEN=1;readyState=1;constructor(){sockets.push(this);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({message_type:'session_started'})}));}send(){}close(){this.readyState=3;this.onclose?.();}message(p){this.onmessage?.({data:JSON.stringify(p)});}}
 globalThis.AudioContext=FakeContext;globalThis.AudioWorkletNode=FakeNode;globalThis.window={AudioWorkletNode:FakeNode};globalThis.WebSocket=FakeSocket;
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true,mediaDevices:{getUserMedia:async()=>{live++;maxLive=Math.max(maxLive,live);let stopped=false;const track={stop(){if(!stopped){stopped=true;live--;}}};return {getTracks:()=>[track],getAudioTracks:()=>[track]};}}},configurable:true});
 const records=[],make=async(name)=>{const box=new api.DeviceOutbox(owner);await box.read();const sid=randomUUID(),cid=randomUUID();await box.enqueue(sid,'/api/notebook',create(sid));await box.beginCapture({id:cid,sessionId:sid,studentId:student,date:day});const originalAudio=box.audio.bind(box);box.audio=(...args)=>quota?Promise.reject(new DOMException('quota','QuotaExceededError')):originalAudio(...args);let state;const rec=new api.ClassRecorder(cid,{status:s=>state=s,partial(){},entry:(text,captureId,kind)=>records.push({name,text,captureId,kind})},box);await rec.prepare();await rec.start(async()=> 'SYNTHETIC_TOKEN_NO_NETWORK');return {rec,box,cid,get state(){return state;}};};
 const b=await make('B');sockets[0].message({message_type:'partial_transcript',text:'B 마지막 미확정 말'});assert.equal((await b.rec.stop()).safe,true);assert.equal(live,0);
 const a=await make('A');assert.equal(maxLive,1);await wait(1850);assert(records.some(r=>r.name==='B'&&r.captureId===b.cid&&r.text.includes('B 마지막 미확정 말')));assert(!records.some(r=>r.name==='A'&&r.text.includes('B 마지막')));
 quota=true;nodeState.current.port.onmessage({data:{pcm:new Uint8Array([5,6]).buffer,level:.1}});await wait(40);assert(a.rec.emergency);assert.equal(live,0);assert.equal((await a.rec.stop()).safe,false);
 quota=false;await a.rec.retryStorage();assert.equal(a.rec.emergency,null);assert.equal((await a.rec.stop()).safe,true);assert.equal(a.state.phase,'paused');
 const d=await make('D'),saveAudio=d.box.audio.bind(d.box);let first=true;d.box.audio=(...args)=>{if(first){first=false;return Promise.reject(new DOMException('one write failed','QuotaExceededError'));}return saveAudio(...args);};
 nodeState.current.port.onmessage({data:{pcm:new Uint8Array([7,8]).buffer,level:.1}});nodeState.current.port.onmessage({data:{pcm:new Uint8Array([9,10]).buffer,level:.1}});await wait(40);await d.rec.stop();
 assert.equal(d.rec.emergency,null);assert.deepEqual(await d.box.readAudio(owner+'/audio-'+d.cid+'-0'),new Uint8Array([1,2,3,4,7,8,9,10]));
 const c=await make('C');ack=false;assert.equal((await c.rec.stop()).safe,false);assert.equal(live,0);ack=true;await c.rec.retryStorage();assert.equal((await c.rec.stop()).safe,true);
});

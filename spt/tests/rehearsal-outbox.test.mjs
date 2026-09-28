import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';import {build} from 'esbuild';import {mkdirSync,writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
mkdirSync('.sites-runtime/rehearsal-contract-tests',{recursive:true});const path='.sites-runtime/rehearsal-contract-tests/outbox-identity.mjs';await build({entryPoints:['lib/outbox.ts'],outfile:path,bundle:true,platform:'node',format:'esm'});const {DeviceOutbox}=await import(pathToFileURL(process.cwd()+'/'+path));
const account='native-11111111-1111-4111-8111-111111111111',partition=account+':rehearsal:11111111-2222-4333-8444-555555555555';
test('existing eight queued rehearsal actions drain under the real account without changing their storage keys or payloads',async()=>{
 const previous=globalThis.fetch,sent=[];globalThis.fetch=async(url,init)=>{if(url==='/api/identity')return Response.json({ownerKey:account});sent.push(JSON.parse(init.body));return Response.json({saved:true,id:sent.at(-1).id});};
 try{
  const old=new DeviceOutbox(partition);await old.read();for(let i=0;i<8;i++){const id=crypto.randomUUID();await old.enqueue(id,'/api/classroom',{id,studentId:'S001',date:'2026-09-14',kind:'activity',entityId:crypto.randomUUID(),recordedAtClient:'2026-09-13T10:50:00.000Z',data:{note:'SYNTHETIC retained action '+i}});}
  const before=structuredClone(old.items);await old.flush();assert.equal(old.pending.length,8);assert.equal(sent.length,0);
  const fixed=new DeviceOutbox(partition,account);await fixed.read();assert.deepEqual(fixed.items,before);await fixed.flush();assert.equal(fixed.pending.length,0);assert.equal(sent.length,8);assert.deepEqual(sent,before.map(x=>x.payload));assert.deepEqual(fixed.items.map(x=>x.key),before.map(x=>x.key));assert.ok(fixed.items.every(x=>x.type==='receipt'));assert.equal(fixed.message,'');
  const otherPartition=new DeviceOutbox(partition+'-separate',account);await otherPartition.read();assert.equal(otherPartition.items.length,0);
 }finally{globalThis.fetch=previous;}
});
test('a different authenticated account still cannot drain the rehearsal partition',async()=>{
 const previous=globalThis.fetch,box=new DeviceOutbox(partition+'-foreign-check',account);let sent=0;await box.read();const id=crypto.randomUUID();await box.enqueue(id,'/api/classroom',{id,data:{note:'SYNTHETIC protected'}});
 globalThis.fetch=async url=>{if(url==='/api/identity')return Response.json({ownerKey:'native-22222222-2222-4222-8222-222222222222'});sent++;return Response.json({saved:true})};
 try{await box.flush();assert.equal(box.pending.length,1);assert.equal(sent,0);}finally{globalThis.fetch=previous;}
});
test('a 200 response without the matching saved revision never clears a classroom action',async()=>{
 const previous=globalThis.fetch,box=new DeviceOutbox(partition+'-ack-contract',account);await box.read();
 const id=crypto.randomUUID();await box.enqueue(id,'/api/classroom',{id,studentId:'S001',date:'2026-09-14',kind:'activity',entityId:crypto.randomUUID(),data:{note:'SYNTHETIC ACK CHECK'}});
 let answer={saved:false,id};globalThis.fetch=async url=>url==='/api/identity'?Response.json({ownerKey:account}):Response.json(answer);
 try{
  for(const invalid of [{saved:false,id},{saved:true,id:crypto.randomUUID()}]){
   answer=invalid;await box.flush();const reopened=new DeviceOutbox(box.owner,account);await reopened.read();
   assert.equal(reopened.pending.length,1,'an unverified reply retains the durable classroom action');
   assert.equal(reopened.items[0].type,'job');assert.equal(reopened.items[0].payload.id,id);
  }
  answer={saved:true,id};await box.flush();assert.equal(box.pending.length,0);assert.equal(box.items[0].type,'receipt');
 }finally{globalThis.fetch=previous;}
});
test('a 200 audio reply for another segment leaves device audio retryable',async()=>{
 const previous=globalThis.fetch,box=new DeviceOutbox(partition+'-audio-ack',account);await box.read();
 const sid=crypto.randomUUID(),cid=crypto.randomUUID();await box.enqueue(sid,'/api/notebook',{action:'create',id:sid,studentId:'S001',date:'2026-09-14',title:'SYNTHETIC',purpose:'test'});
 await box.beginCapture({id:cid,sessionId:sid,studentId:'S001',date:'2026-09-14'});await box.audio(cid,0,Uint8Array.from([1,2]),true,1/16000);
 let seq=1,audioId=cid;globalThis.fetch=async(url,init)=>{if(url==='/api/identity')return Response.json({ownerKey:account});if(url.startsWith('/api/audio?'))return Response.json({saved:true,id:audioId,seq});if(url==='/api/capture')return Response.json({saved:true});const p=JSON.parse(init.body);return Response.json({saved:true,id:p.id});};
 try{
  await box.flush();const reopened=new DeviceOutbox(box.owner,account);await reopened.read();
  const audio=reopened.pending.find(x=>x.audioSize);assert.ok(audio,'unmatched audio acknowledgement must not discard the segment');
  assert.deepEqual(await reopened.readAudio(audio.key),Uint8Array.from([1,2]));
  seq=0;audioId=crypto.randomUUID();await reopened.flush();assert.equal(reopened.pending.filter(x=>x.audioSize).length,1,'another capture with the same seq is not this original');
  const afterWrongCapture=new DeviceOutbox(box.owner,account);await afterWrongCapture.read();assert.deepEqual(await afterWrongCapture.readAudio(audio.key),Uint8Array.from([1,2]));
  audioId=cid;await afterWrongCapture.flush();assert.equal(afterWrongCapture.pending.filter(x=>x.audioSize).length,0);
 }finally{globalThis.fetch=previous;}
});

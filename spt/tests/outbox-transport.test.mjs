import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const output='.sites-runtime/outbox-transport-tests/outbox.mjs';
mkdirSync('.sites-runtime/outbox-transport-tests',{recursive:true});
await build({entryPoints:['lib/outbox.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
const {DeviceOutbox}=await import(pathToFileURL(process.cwd()+'/'+output));

test('injected transport checks the owner and retains a job until its exact acknowledgement',async()=>{
 const owner='SYNTHETIC-'+crypto.randomUUID(),id=crypto.randomUUID(),calls=[];
 let identityOwner='another-owner',ack={saved:true,id};
 const transport=async(url,init)=>{
  calls.push({url,init});
  if(url==='/api/identity')return Response.json({ownerKey:identityOwner});
  assert.equal(url,'/api/classroom');
  return Response.json(ack);
 };
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>{throw new Error('injected transport must handle every outbox request');};
 try{
  const box=new DeviceOutbox(owner,owner,transport);
  await box.read();
  await box.enqueue(id,'/api/classroom',{id,studentId:'S001',kind:'activity',data:{note:'SYNTHETIC transport check'}});
  await box.enqueue(id,'/api/classroom',{id,studentId:'S999',kind:'activity'});
  const original=structuredClone(box.items[0]);
  assert.equal(box.pending.length,1,'reusing a job ID must not replace its durable payload');

  await box.flush();
  assert.deepEqual(calls.map(call=>call.url),['/api/identity']);
  assert.equal(calls[0].init.cache,'no-store');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.deepEqual(box.items,[original]);

  identityOwner=owner;
  for(const invalid of [{saved:false,id},{saved:true,id:crypto.randomUUID()}]){
   ack=invalid;
   await box.flush();
   const reopened=new DeviceOutbox(owner,owner,transport);
   await reopened.read();
   assert.equal(reopened.pending.length,1);
   assert.equal(reopened.items[0].type,'job');
   assert.equal(reopened.items[0].key,original.key);
   assert.deepEqual(reopened.items[0].payload,original.payload);
  }

  const posts=calls.filter(call=>call.url==='/api/classroom');
  assert.equal(posts.length,2);
  for(const {init} of posts){
   assert.equal(init.method,'POST');
   assert.equal(init.headers['Content-Type'],'application/json');
   assert.ok(init.signal instanceof AbortSignal);
   assert.deepEqual(JSON.parse(init.body),original.payload);
  }
  ack={saved:true,id};
  await box.flush();
  assert.equal(box.pending.length,0);
  assert.equal(box.items[0].type,'receipt');
  assert.equal(box.items[0].key,original.key);
  assert.deepEqual(box.items[0].payload,original.payload);
 }finally{globalThis.fetch=previous;}
});

test('omitting the transport keeps the same-origin fetch path',async()=>{
 const owner='SYNTHETIC-'+crypto.randomUUID(),id=crypto.randomUUID(),calls=[];
 const previous=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{
  calls.push({url,init});
  if(url==='/api/identity')return Response.json({ownerKey:owner});
  assert.equal(url,'/api/notebook');
  return Response.json({saved:true,id});
 };
 try{
  const box=new DeviceOutbox(owner);
  await box.read();
  await box.enqueue(id,'/api/notebook',{action:'entry',id,kind:'observation_card:test',data:{text:'SYNTHETIC default path'}});
  await box.flush();
  assert.deepEqual(calls.map(call=>call.url),['/api/identity','/api/notebook']);
  assert.equal(calls[1].init.method,'POST');
  assert.equal(box.pending.length,0);
  assert.equal(box.items[0].type,'receipt');
 }finally{globalThis.fetch=previous;}
});

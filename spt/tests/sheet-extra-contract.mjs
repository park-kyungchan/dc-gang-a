// Fake HMAC peer and invented native account. No real Sheet or credentials.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac} from 'node:crypto';
import {build} from 'esbuild';

const env=globalThis.__syntheticSheetExtraEnv={};
const bundled=await build({entryPoints:['lib/sheet-bridge.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'fake-runtime',setup(build){
 build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));
 build.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'fixture'}));
 build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='env'?'export const env=globalThis.__syntheticSheetExtraEnv':'export async function headers(){return new Headers()}'}));
}}]});
const {bridgeConfigured,bridgeCall}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const owner='native-11111111-1111-4111-8111-111111111111',foreign='native-22222222-2222-4222-8222-222222222222';
const date='2026-10-06',url='https://script.google.com/macros/s/SYNTHETIC_FIXTURE/exec',key='SYNTHETIC-HMAC-KEY-NOT-A-CREDENTIAL-0001';
const valid={SPT_SHEET_BRIDGE_OWNER_KEY:owner,SPT_SHEET_BRIDGE_URL:url,SPT_SHEET_BRIDGE_KEY:key};
function set(values){for(const name of Object.keys(env))delete env[name];Object.assign(env,values);}

test('native Sheet authorization is exact and fails before transport',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('network forbidden');};
 try{
  for(const changes of [{SPT_SHEET_BRIDGE_OWNER_KEY:foreign},{SPT_SHEET_BRIDGE_KEY:'short'},{SPT_SHEET_BRIDGE_URL:'http://example.invalid/exec'}]){
   set({...valid,...changes});assert.equal(bridgeConfigured(owner),changes.SPT_SHEET_BRIDGE_URL!==undefined);
   await assert.rejects(()=>bridgeCall('snapshot',{actorKey:owner,date}));assert.equal(calls,0);
  }
  set(valid);assert.equal(bridgeConfigured(foreign),false);await assert.rejects(()=>bridgeCall('snapshot',{actorKey:foreign,date}));assert.equal(calls,0);
 }finally{globalThis.fetch=original;set({});}
});

test('a signed synthetic snapshot uses only the bound actor and returns peer acknowledgement',async()=>{
 set(valid);const original=globalThis.fetch;let seen=0;
 globalThis.fetch=async(target,options)=>{
  seen++;assert.equal(target,url);assert.equal(options.method,'POST');
  const signed=JSON.parse(options.body),{signature,...message}=signed;
  assert.equal(message.action,'snapshot');assert.deepEqual(message.payload,{actorKey:owner,date});
  assert.equal(signature,createHmac('sha256',key).update(JSON.stringify(message)).digest('hex'));
  return Response.json({ok:true,snapshot:{date,synthetic:true}});
 };
 try{const result=await bridgeCall('snapshot',{actorKey:owner,date});assert.deepEqual(result.snapshot,{date,synthetic:true});assert.equal(seen,1);}finally{globalThis.fetch=original;set({});}
});

test('rehearsal forbids live closeout payload before transport',async()=>{
 set({...valid,SPT_REHEARSAL_ID:'11111111-2222-4333-8444-555555555555',SPT_REHEARSAL_DATE:date,SPT_REHEARSAL_STUDENTS:'["FAKE-ALPHA"]',SPT_BACKEND_MODE:'paired-local',SPT_BACKEND_OWNER_KEY:owner});
 const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('network forbidden');};
 try{
  for(const payload of [{actorKey:owner,studentId:'FAKE-ALPHA',date,closeout:{confirmed:true}},{actorKey:owner,studentId:'FAKE-BETA',date,closeout:{test:true}},{actorKey:owner,studentId:'FAKE-ALPHA',date:'2026-10-07',closeout:{test:true}}])await assert.rejects(()=>bridgeCall('commitCloseout',payload));
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;set({});}
});

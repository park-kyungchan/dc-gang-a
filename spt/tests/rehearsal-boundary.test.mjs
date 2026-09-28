// Isolated launcher bindings and fake requests only. No backend or provider is contacted.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';

const env=globalThis.__syntheticRehearsalEnv={};
const bundled=await build({entryPoints:['lib/rehearsal.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'fake-worker-env',setup(build){build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__syntheticRehearsalEnv'}));}}]});
const {rehearsalScope,rehearsalId}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const valid={SPT_REHEARSAL_ID:'11111111-2222-4333-8444-555555555555',SPT_REHEARSAL_DATE:'2026-10-06',SPT_REHEARSAL_STUDENTS:JSON.stringify(['FAKE-ALPHA','FAKE-BETA']),SPT_BACKEND_MODE:'paired-local',SPT_BACKEND_OWNER_KEY:'native-11111111-1111-4111-8111-111111111111'};
function set(values){for(const key of Object.keys(env))delete env[key];Object.assign(env,values);}

test('rehearsal exists only with a complete trusted launcher binding',()=>{
 set({});assert.equal(rehearsalScope(),null);assert.equal(rehearsalId(),null);
 set(valid);assert.deepEqual(rehearsalScope(),{id:valid.SPT_REHEARSAL_ID,date:valid.SPT_REHEARSAL_DATE,studentIds:['FAKE-ALPHA','FAKE-BETA']});assert.equal(rehearsalId(),valid.SPT_REHEARSAL_ID);
});

test('malformed or broad bindings fail closed',()=>{
 const changes=[{SPT_REHEARSAL_ID:'../../classroom'},{SPT_BACKEND_MODE:'production'},{SPT_BACKEND_OWNER_KEY:undefined},{SPT_REHEARSAL_DATE:'2026-02-30'},{SPT_REHEARSAL_STUDENTS:'["FAKE-ALPHA","FAKE-ALPHA"]'},{SPT_REHEARSAL_STUDENTS:'["FAKE-ALPHA","FAKE-BETA","FAKE-GAMMA","FAKE-DELTA"]'},{SPT_REHEARSAL_STUDENTS:'["../outside"]'},{SPT_REHEARSAL_STUDENTS:'not-json'}];
 for(const change of changes){set({...valid,...change});assert.throws(()=>rehearsalScope(),undefined,JSON.stringify(change));}
 set({});
});

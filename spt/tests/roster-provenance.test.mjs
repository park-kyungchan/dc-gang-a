// Actual roster metadata function with an isolated DB read; no service or data writes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='.sites-runtime/preview-e2e-tests';mkdirSync(out,{recursive:true});
globalThis.__rosterRecord=null;
const bundle=await build({entryPoints:['lib/roster-server.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'private-roster-db',setup(b){
 b.onResolve({filter:/^\.\/server$/},a=>a.importer.replaceAll('\\','/').endsWith('/lib/roster-server.ts')?{path:a.path,namespace:'fixture-db'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture-db'},()=>({contents:'export const db=()=>({prepare(sql){globalThis.__rosterSQL=sql;return {bind(){return {first:async()=>globalThis.__rosterRecord}}}}});'}));
}}]});writeFileSync(out+'/roster-provenance.mjs',bundle.outputFiles[0].text);
const {readRoster}=await import('../'+out+'/roster-provenance.mjs');
await test('initial roster is not presented as a teacher-confirmed Sheet import',async()=>{
 globalThis.__rosterRecord=null;const r=await readRoster('private-fixture');assert.deepEqual(r.roster,[]);assert.equal(r.rosterSource,'initial');assert.equal(r.rosterRevision,'');
});
await test('synthetic provenance survives the server read for visible E2E labeling',async()=>{
 const students=[{id:'QA_SPT_A',name:'가상학생 A'}];globalThis.__rosterRecord={id:'fixture-revision',body:JSON.stringify({students}),source_hash:'SYNTHETIC_NOT_A_SHEET_READ'};
 const r=await readRoster('private-fixture');assert.deepEqual(r.roster,students);assert.equal(r.rosterSource,'synthetic');assert.match(globalThis.__rosterSQL,/source_hash/);
});
await test('normal imported roster remains Sheet-sourced with its exact revision',async()=>{
 globalThis.__rosterRecord={id:'normal-revision',body:'{"students":[]}',source_hash:'a'.repeat(64)};const r=await readRoster('private-fixture');assert.equal(r.rosterSource,'sheet');assert.equal(r.rosterRevision,'normal-revision');
});

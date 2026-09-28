// Read-only Site audit: bundle in memory, SQLite fixtures, no provider calls.
// Fails if an internal owner hash escapes through a receipt ID or Sheet actor.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const require=createRequire(root+'/package.json'),{build}=require('esbuild');
const runtime={};globalThis.__datasetSheetEnv=runtime;globalThis.__datasetSheetHeaders=new Headers();
const bundle=await build({stdin:{contents:"export * as dataset from './app/api/dataset/route';export * as server from './lib/server';",resolveDir:root,sourcefile:'dataset-sheet-fixture.ts'},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'memory-runtime',setup(b){
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'memory'}));
 b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'memory'}));
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'memory'}));
 b.onLoad({filter:/.*/,namespace:'memory'},x=>({contents:x.path==='env'?'export const env=globalThis.__datasetSheetEnv':x.path==='headers'?'export async function headers(){return globalThis.__datasetSheetHeaders}':'export function redirect(){throw new Error("unexpected redirect")}'}));
}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sql=new DatabaseSync(':memory:');for(const file of readdirSync(root+'/drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(root+'/drizzle/'+file,'utf8'));
runtime.DB={prepare(query){return{bind(...values){return{async first(){return sql.prepare(query).get(...values)||null;},async all(){return{results:sql.prepare(query).all(...values)};},async run(){const result=sql.prepare(query).run(...values);return{meta:{changes:Number(result.changes)}};}};}};}};
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Network forbidden in this fixture');};
const sign=label=>globalThis.__datasetSheetHeaders=new Headers({'oai-authenticated-user-email':label+'@example.invalid'});
const day='2026-09-09',observed='2026-09-12T12:34:56.000Z',sourceRead='2026-09-12T12:34:55.000Z';
const request=view=>new Request(`https://spt.example/api/dataset?from=${day}&to=${day}&view=${view}`);
const rows=async(response)=>{assert.equal(response.status,200);return(await response.text()).trim().split('\n').map(JSON.parse);};
const exported=async(view='current')=>rows(await api.dataset.GET(request(view)));

try{
 await test('Sheet export preserves observed-time revisions and source references while isolating owners and internal storage identifiers',async()=>{
  sign('dataset-sheet-owner-a');const owner=await api.server.owner();sign('dataset-sheet-owner-b');const other=await api.server.owner();sign('dataset-sheet-owner-a');
  const snapshot=(text,actor=owner)=>({schema:1,spreadsheetId:'SYNTHETIC_SHEET',date:day,readAt:sourceRead,profileSource:{profiles:[{id:'S004',sourceRow:17,cells:[{field:'grade',a1:'E17',raw:{type:'number',value:0},display:'0',formula:'=0'}]}]},mainSource:{rows:[]},tracker:{version:'SYNTHETIC',catalog:{},events:[{id:'REQ-SYNTHETIC-REMOTE',created:day,actor:'SPT:'+actor,type:'REVIEW',studentId:'S004',date:day,data:{progress:text,sourceId:'SYNTHETIC-CLOSEOUT'}},{id:'REQ-SYNTHETIC-NATIVE',created:day,actor:'native-sheet-teacher@example.invalid',type:'PROGRESS',studentId:'S004',date:day,data:{text:'SYNTHETIC SOURCE LABEL'}}],students:[{studentId:'S004',revision:'revision-'+text}],attendance:[]}});
  const insertSnapshot=(id,who,text)=>sql.prepare('INSERT INTO spt_sheet_snapshots(id,owner,class_date,content_hash,body,observed_at) VALUES(?,?,?,?,?,?)').run(id,who,day,'content-'+text,JSON.stringify(snapshot(text,who)),observed);
  insertSnapshot('snapshot-old',owner,'FIRST_RECORDED_SOURCE');insertSnapshot('snapshot-current',owner,'CHANGED_SOURCE_CONTENT');insertSnapshot('snapshot-other',other,'OTHER_TEACHER_ONLY');
  sql.prepare('INSERT INTO spt_sheet_receipts(id,owner,student_id,class_date,entry_id,remote_id,source_signature,remote_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(owner+':SYNTHETIC-CLOSEOUT',owner,'S004',day,'SYNTHETIC-CLOSEOUT','REQ-SYNTHETIC-REMOTE','SYNTHETIC-SIGNATURE','revision-CHANGED_SOURCE_CONTENT',observed);
  sql.prepare('INSERT INTO spt_sheet_receipts(id,owner,student_id,class_date,entry_id,remote_id,source_signature,remote_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(other+':OTHER-CLOSEOUT',other,'S004',day,'OTHER-CLOSEOUT','REQ-OTHER-REMOTE','OTHER-SIGNATURE','OTHER-REVISION',observed);
  sql.prepare('INSERT INTO spt_sessions(id,owner,student_id,class_date,title,purpose,created_at) VALUES(?,?,?,?,?,?,?)').run('session-own',owner,'S004',day,'SYNTHETIC','lesson',observed);
  sql.prepare('INSERT INTO spt_captures(id,owner,session_id,state,created_at) VALUES(?,?,?,?,?)').run('capture-own',owner,'session-own','done',observed);
  sql.prepare('INSERT INTO spt_audio_chunks(id,owner,capture_id,seq,size,hash,object_key,created_at) VALUES(?,?,?,?,?,?,?,?)').run('chunk-own',owner,'capture-own',0,5,'SYNTHETIC-HASH',owner+'/PRIVATE_RAW_OBJECT_KEY',observed);
  const currentResponse=await api.dataset.GET(request('current')),historyResponse=await api.dataset.GET(request('history'));
  insertSnapshot('snapshot-after-cutoff',owner,'AFTER_EXPORT_STARTED');
  const current=await rows(currentResponse),history=await rows(historyResponse);
  const currentSources=current.filter(r=>r.record_type==='sheet_source_snapshot'),historySources=history.filter(r=>r.record_type==='sheet_source_snapshot');
  assert.deepEqual(currentSources.map(r=>r.id),['snapshot-current']);assert.deepEqual(historySources.map(r=>[r.id,r.revision_state]),[['snapshot-old','superseded'],['snapshot-current','current']]);
  assert.equal(currentSources[0].created_at,observed);assert.equal(currentSources[0].created_at_semantics,'app_observed_at_not_source_edit_time');assert.equal(currentSources[0].source_snapshot.readAt,sourceRead);assert.equal(currentSources[0].class_date,day);assert(!('server_received_at' in currentSources[0]));assert(!('actual_observation_at' in currentSources[0]));
  assert.equal(currentSources[0].source_snapshot.profileSource.profiles[0].cells[0].formula,'=0');assert.equal(currentSources[0].source_snapshot.profileSource.profiles[0].cells[0].raw.value,0);
  assert.equal(historySources[0].source_snapshot.tracker.events[0].id,historySources[1].source_snapshot.tracker.events[0].id);assert.notEqual(historySources[0].source_snapshot.tracker.events[0].data.progress,historySources[1].source_snapshot.tracker.events[0].data.progress);
  const pseudonym='SPT:dataset-'+createHash('sha256').update('spt-dataset-actor-v1:SPT:'+owner).digest('hex');
  for(const source of [...currentSources,...historySources]){const events=source.source_snapshot.tracker.events;assert.equal(events[0].actor,pseudonym);assert.equal(events[0].actor_identity_semantics,'stable_export_pseudonym_sha256_v1');assert.equal(events[1].actor,'native-sheet-teacher@example.invalid');assert(!('actor_identity_semantics' in events[1]));}
  const unchanged=JSON.parse(sql.prepare('SELECT body FROM spt_sheet_snapshots WHERE id=?').get('snapshot-current').body);assert.equal(unchanged.tracker.events[0].actor,'SPT:'+owner);assert(!('actor_identity_semantics' in unchanged.tracker.events[0]));
  const receipt=current.find(r=>r.record_type==='sheet_sync_receipt');assert.equal(receipt.id,'sheet-receipt:SYNTHETIC-CLOSEOUT');assert.equal(receipt.entry_id,'SYNTHETIC-CLOSEOUT');assert.equal(receipt.remote_id,'REQ-SYNTHETIC-REMOTE');assert.equal(receipt.created_at_semantics,'server_received_at');
  assert.equal(current.at(-1).record_type,'export_complete');assert.equal(current.at(-1).counts.sheet_source_snapshot,1);assert.equal(history.at(-1).counts.sheet_source_snapshot,2);
  assert(!JSON.stringify(history).includes('OTHER_TEACHER_ONLY'));assert(!JSON.stringify(history).includes('OTHER-CLOSEOUT'));assert(!JSON.stringify(history).includes('AFTER_EXPORT_STARTED'));
  sign('dataset-sheet-owner-b');const otherRows=await exported();assert.deepEqual(otherRows.filter(r=>r.record_type==='sheet_source_snapshot').map(r=>r.id),['snapshot-other']);assert(!JSON.stringify(otherRows).includes('CHANGED_SOURCE_CONTENT'));assert(!JSON.stringify(otherRows).includes('SYNTHETIC-CLOSEOUT\",\"remote_id'));
  globalThis.__datasetSheetHeaders=new Headers();assert.equal((await api.dataset.GET(request('current'))).status,401);
  const leaks=[];for(const [label,records] of [['current',current],['history',history]]){
   const serialized=JSON.stringify(records);if(serialized.includes(owner))leaks.push(label+': raw authenticated owner value');if(serialized.includes('PRIVATE_RAW_OBJECT_KEY'))leaks.push(label+': raw audio object key');
   if(records.some(r=>'owner' in r||'object_key' in r||'_row' in r))leaks.push(label+': internal storage field');
  }
  assert.deepEqual(leaks,[],'Internal storage identifiers must not leak through receipt IDs or nested Sheet actors');
 });
}finally{globalThis.fetch=originalFetch;sql.close();}

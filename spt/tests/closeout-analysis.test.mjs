import {syntheticRosterPlugin} from './fixtures/synthetic-roster-plugin.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';

// Real route handlers and SQLite, with an explicitly fake native transport.
// No OAuth, native worker or network request belongs in the default test suite.
const sql = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()) sql.exec(readFileSync('drizzle/'+f,'utf8'));
let breakBatch = false;
globalThis.__closeEnv = {DB:{
  prepare(query){return {bind(...v){return {async first(){return sql.prepare(query).get(...v)||null;},async all(){return {results:sql.prepare(query).all(...v)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...v).changes)}};}};}};},
  async batch(statements){if(breakBatch)throw new Error('SYNTHETIC_PERSISTENCE_FAILURE');sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}},
}};
globalThis.__closeHeaders = new Headers({'oai-authenticated-user-email':'closeout-fixture@example.invalid'});
const bundle = await build({stdin:{contents:"export * as api from './app/api/closeout-analysis/route';export * as classroom from './app/api/classroom/route';export * as notebook from './app/api/notebook/route';export * as review from './lib/closeout-review';export * as analysis from './lib/closeout-analysis';export * as model from './lib/classroom';export * as server from './lib/server';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[syntheticRosterPlugin,{name:'private-runtime',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'fixture'}));b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},x=>({contents:x.path==='env'?'export const env=globalThis.__closeEnv':x.path==='headers'?'export async function headers(){return globalThis.__closeHeaders}':'export function redirect(){throw new Error("redirect")}' }));}}]});
writeFileSync('.sites-runtime/closeout-analysis-test.mjs',bundle.outputFiles[0].text);
const {api,classroom,notebook,review,analysis,model,server} = await import('../.sites-runtime/closeout-analysis-test.mjs');
const owner = await server.owner();
const req=(path,p)=>new Request('https://spt.example'+path,{method:'POST',headers:{'Content-Type':'application/json',origin:'https://spt.example'},body:JSON.stringify(p)});
const good=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json();};
let counter=0, calls=0;
async function fixture(){
  const date=`2026-10-${String(++counter).padStart(2,'0')}`, sessionId=randomUUID(), sourceId=randomUUID();
  await good(await notebook.POST(req('/api/notebook',{action:'create',id:sessionId,studentId:'S001',date,title:'SYNTHETIC ANALYSIS'})));
  await good(await notebook.POST(req('/api/notebook',{action:'entry',id:sourceId,sessionId,kind:'transcript',data:{text:'SYNTHETIC progress and homework, no inferred date.'}})));
  return {date,sessionId,sourceId};
}
async function input(f){return {studentId:'S001',date:f.date,basis:review.closeoutEvidenceBasis('S001',f.date,await analysis.loadCloseoutEvidence(owner,'S001',f.date))};}
const run=async(f,extra={})=>api.POST(req('/api/closeout-analysis',{...await input(f),...extra}));
const count=(f,kind)=>sql.prepare('SELECT COUNT(*) n FROM spt_entries WHERE session_id=? AND kind=?').get(f.sessionId,kind).n;
function answer(payload){return {native:{route:'deterministic-test-double',cost:'not-a-provider-run'},output:{drafts:payload.sessions.map(s=>({sessionId:s.sessionId,draft:{protocol:'spt.conversation-draft.v1',basisEntryIds:s.entries.map(e=>e.id),candidates:[{id:'p1',kind:'progress',text:'SYNTHETIC progress',attribution:'teacher_statement',evidenceIds:[s.entries[0].id],uncertainty:''},{id:'h1',kind:'homework',text:'SYNTHETIC homework',attribution:'uncertain',evidenceIds:[s.entries[0].id],uncertainty:'date unknown'}]}}))}};}
function transport(fn=answer){globalThis.fetch=async(url,opts)=>{assert.equal(url,'http://127.0.0.1:4176/analyze');assert.equal(opts.headers['X-SPT-Owner'],owner);assert.equal(opts.headers.Authorization,'Bearer '+'SYNTHETIC-TOKEN-'.repeat(3));calls++;return Response.json(await fn(JSON.parse(opts.body)));};}
function configured(){Object.assign(globalThis.__closeEnv,{SPT_NATIVE_ANALYSIS_URL:'http://127.0.0.1:4176/analyze',SPT_NATIVE_ANALYSIS_OWNER_KEY:owner,SPT_NATIVE_ANALYSIS_TOKEN:'SYNTHETIC-TOKEN-'.repeat(3)});}

await test('disconnected, unauthenticated, wrong subject and stale client inputs cannot dispatch',async()=>{
  const f=await fixture();globalThis.fetch=()=>{throw new Error('UNEXPECTED_NETWORK');};
  assert.equal((await run(f)).status,503);assert.equal(count(f,'closeout_analysis'),0);
  assert.equal((await run(f,{studentId:'NOT_IN_ROSTER'})).status,400);
  assert.equal((await run(f,{basis:'stale'})).status,409);
  const prior=globalThis.__closeHeaders;globalThis.__closeHeaders=new Headers();assert.equal((await run(f)).status,401);globalThis.__closeHeaders=prior;
  assert.equal(calls,0);
});
let successful;
await test('concurrent opens reserve once, retain a real draft entry, and reuse without another call',async()=>{
  configured();const f=await fixture();successful=f;transport();const before=calls;
  const results=await Promise.all([run(f).then(good),run(f).then(good)]);
  assert.ok(results.some(r=>r.state==='ready'));assert.equal(calls-before,1);
  assert.equal(count(f,'closeout_analysis'),1);assert.equal(count(f,'ai_draft'),1);assert.equal(count(f,'closeout_analysis_result'),1);
  assert.equal((await good(await run(f))).state,'cached');assert.equal(calls-before,1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events').get().n,0);
});
await test('foreign or malformed native output stays private/invalid and never becomes applicable',async()=>{
  const f=await fixture();const before=calls;transport(p=>{const a=answer(p);a.output.drafts[0].sessionId=randomUUID();return a;});
  assert.equal((await good(await run(f))).state,'invalid');assert.equal(count(f,'ai_draft'),0);assert.equal(count(f,'closeout_analysis_result'),1);
  assert.equal((await good(await run(f))).state,'unusable');assert.equal(calls-before,1);
});
await test('unknown native result is retained and reopening does not silently retry',async()=>{
  const f=await fixture();const before=calls;transport(()=>{throw new TypeError('SYNTHETIC_CONNECTION_LOSS');});
  assert.equal((await good(await run(f))).state,'unknown');assert.equal((await good(await run(f))).state,'unusable');assert.equal(calls-before,1);
});
await test('interrupted persistence keeps the attempt and prevents a second paid request',async()=>{
  const f=await fixture();const before=calls;transport();breakBatch=true;
  assert.equal((await run(f)).status,500);breakBatch=false;assert.equal(count(f,'ai_draft'),0);assert.equal(count(f,'closeout_analysis'),1);
  assert.equal((await good(await run(f))).state,'unknown');assert.equal(calls-before,1);
});
await test('late source keeps returned drafts stale; changed evidence needs an explicit request identity',async()=>{
  const f=await fixture();const before=calls;
  transport(async p=>{await good(await notebook.POST(req('/api/notebook',{action:'entry',id:randomUUID(),sessionId:f.sessionId,kind:'transcript',data:{text:'SYNTHETIC late correction'}})));return answer(p);});
  assert.equal((await good(await run(f))).state,'stale');const next=await good(await run(f));assert.equal(next.state,'changed');assert.equal(calls-before,1);
  transport();assert.equal((await good(await run(f,{reanalyseFrom:next.requestId}))).state,'ready');assert.equal(calls-before,2);
});
await test('teacher apply validates lineage/date, preserves one replay revision and rejects stale final confirmation',async()=>{
  const f=successful;const data=await analysis.loadCloseoutEvidence(owner,'S001',f.date), draft=data.events.find(e=>e.kind==='ai_draft');
  const basis=review.closeoutEvidenceBasis('S001',f.date,data), edits=review.reviewProposal(draft,data.events).edits;
  edits.progress='SYNTHETIC teacher correction';edits.due='2026-10-20';
  const close=review.applyReviewedDraft(draft,data.events,model.blankCloseout,edits,basis);
  const p={id:randomUUID(),kind:'closeout',entityId:'closeout:S001:'+f.date,studentId:'S001',date:f.date,baseId:'',data:close};
  const save=v=>classroom.POST(req('/api/classroom',v));
  assert.equal((await save({...p,data:{...close,due:''}})).status,409);
  assert.equal((await save({...p,data:{...close,draftReview:{...close.draftReview,draftId:randomUUID()}}})).status,409);
  assert.equal((await save({...p,studentId:'S002',entityId:'closeout:S002:'+f.date})).status,409);
  assert.equal((await save({...p,data:{...close,confirmed:true}})).status,409);
  await good(await save(p));await good(await save(p));assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events WHERE entity_id=?').get(p.entityId).n,1);
  const stripped=structuredClone(close);delete stripped.evidenceBasis;
  assert.equal((await save({...p,id:randomUUID(),baseId:p.id,data:stripped})).status,409);
  assert.equal((await save({...p,id:randomUUID()})).status,409);
  const teacherConfirm={...p,id:randomUUID(),baseId:p.id,data:{...close,confirmed:true}};await good(await save(teacherConfirm));
  await good(await notebook.POST(req('/api/notebook',{action:'entry',id:randomUUID(),sessionId:f.sessionId,kind:'transcript',data:{text:'SYNTHETIC NEW FACT'}})));
  assert.equal((await save({...teacherConfirm,id:randomUUID(),baseId:teacherConfirm.id,data:{...teacherConfirm.data,departedAt:new Date().toISOString()}})).status,409);
  assert.equal(review.closeoutCurrent(teacherConfirm.data,review.closeoutEvidenceBasis('S001',f.date,await analysis.loadCloseoutEvidence(owner,'S001',f.date))),false);
});
await test('validated rehearsal uses4182 while ordinary execution still refuses that endpoint',async()=>{
 const env=globalThis.__closeEnv,keys=['SPT_REHEARSAL_ID','SPT_REHEARSAL_DATE','SPT_REHEARSAL_STUDENTS','SPT_BACKEND_MODE','SPT_BACKEND_OWNER_KEY','SPT_BACKEND_SESSION_TOKEN','SPT_NATIVE_ANALYSIS_URL','SPT_NATIVE_ANALYSIS_OWNER_KEY','SPT_NATIVE_ANALYSIS_TOKEN'];
 const previous=new Map(keys.map(k=>[k,{present:Object.hasOwn(env,k),value:env[k]}])),oldHeaders=globalThis.__closeHeaders,oldFetch=globalThis.fetch;
 const actor='native-11111111-1111-4111-8111-111111111111',date='2026-11-01',token='SYNTHETIC-SESSION-TOKEN-01234567890123456789';let received=0;
 Object.assign(env,{SPT_REHEARSAL_ID:'11111111-2222-4333-8444-555555555555',SPT_REHEARSAL_DATE:date,SPT_REHEARSAL_STUDENTS:JSON.stringify(['S001','S002']),SPT_BACKEND_MODE:'paired-local',SPT_BACKEND_OWNER_KEY:actor,SPT_BACKEND_SESSION_TOKEN:token,SPT_NATIVE_ANALYSIS_URL:'http://127.0.0.1:4182/analyze',SPT_NATIVE_ANALYSIS_OWNER_KEY:actor,SPT_NATIVE_ANALYSIS_TOKEN:token});globalThis.__closeHeaders=new Headers({'x-spt-backend-token':token});
 const seed=async studentId=>{const sessionId=randomUUID();await good(await notebook.POST(req('/api/notebook',{action:'create',id:sessionId,studentId,date,title:'SYNTHETIC REHEARSAL'})));await good(await notebook.POST(req('/api/notebook',{action:'entry',id:randomUUID(),sessionId,kind:'transcript',data:{text:'SYNTHETIC rehearsal teacher statement'}})));};
 const invoke=async studentId=>api.POST(req('/api/closeout-analysis',{studentId,date,basis:review.closeoutEvidenceBasis(studentId,date,await analysis.loadCloseoutEvidence(actor,studentId,date))}));
 globalThis.fetch=async(url,options)=>{assert.equal(url,'http://127.0.0.1:4182/analyze');assert.equal(options.headers['X-SPT-Owner'],actor);received++;return Response.json(answer(JSON.parse(options.body)));};
 try{await seed('S001');assert.equal((await good(await invoke('S001'))).state,'ready');assert.equal(received,1);await seed('S002');env.SPT_NATIVE_ANALYSIS_URL='http://127.0.0.1:4176/analyze';assert.equal((await invoke('S002')).status,503);delete env.SPT_REHEARSAL_ID;delete env.SPT_REHEARSAL_DATE;delete env.SPT_REHEARSAL_STUDENTS;env.SPT_NATIVE_ANALYSIS_URL='http://127.0.0.1:4182/analyze';assert.equal((await invoke('S002')).status,503);assert.equal(received,1);}
 finally{for(const [k,v] of previous){if(v.present)env[k]=v.value;else delete env[k];}globalThis.__closeHeaders=oldHeaders;globalThis.fetch=oldFetch;}
});

import {syntheticRosterPlugin} from './fixtures/synthetic-roster-plugin.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {writeFileSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
mkdirSync('.sites-runtime/activity-scope-27b335',{recursive:true});
const built=await build({stdin:{contents:"export * from './lib/classroom';export * from './lib/curriculum';export * from './lib/closeout-review';export * from './lib/activity-scope';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
writeFileSync('.sites-runtime/activity-scope-27b335/domain-test.mjs',built.outputFiles[0].text);
const m=await import('../.sites-runtime/activity-scope-27b335/domain-test.mjs');
const catalog={revision:'QA_C1',books:[{id:'QA_BOOK',name:'합성 교재',code:'QA',source:'SYNTHETIC',version:'1',start:1,end:90,excluded:[]}],units:[],assignments:[{studentId:'QA_A',bookId:'QA_BOOK',slot:1}]};
const scope={...m.makeScope(catalog,'QA_A','QA_BOOK',[]),pageRanges:[{start:46,end:69}],excludedPages:[63,64]};
const draft={activityId:randomUUID(),baseRevisionId:randomUUID(),scope};

test('existing plan validator retains separate activity-scope edits without dropping other drafts',()=>{
 const input={titles:['DT'],scopeDraft:{scope:null,activities:[]},homeworkDraft:{items:[],scope:null,actions:[],due:'',noHomework:false},activityScopeDrafts:[draft,{...draft,activityId:randomUUID(),scope:null}]};
 const got=m.validateClass('plan',input,'2040-01-02');assert.deepEqual(got.activityScopeDrafts,input.activityScopeDrafts);assert.deepEqual(got.homeworkDraft,input.homeworkDraft);assert.deepEqual(got.scopeDraft,input.scopeDraft);
});
test('scope-only edit preserves original activity, actual-work fields, state and every timing field',()=>{
 const prior={...m.task('DT','2040-01-02'),state:'done',attempted:'p.45~48',marked:'separate observed fact',unresolved:'one remaining check',timing:{assignedAt:'2040-01-02T01:00:00.000Z',stoppedAt:'2040-01-02T01:10:00.000Z',visitedAt:'',revisitAt:''}};
 const event={id:draft.baseRevisionId,entity_id:draft.activityId,student_id:'QA_A',class_date:'2039-12-31',kind:'activity',body:JSON.stringify(prior)};
 const got=m.applyActivityScope(event,draft,'QA_A','2040-01-02',catalog);assert.deepEqual(got,{...prior,scope,range:m.scopeText(scope)});assert.equal(event.class_date,'2039-12-31');assert.deepEqual(JSON.parse(event.body),prior);
 for(const [e,d,s,date,c] of [[event,{...draft,baseRevisionId:randomUUID()},'QA_A','2040-01-02',catalog],[event,{...draft,activityId:randomUUID()},'QA_A','2040-01-02',catalog],[event,draft,'QA_B','2040-01-02',catalog],[event,draft,'QA_A','2040-01-03',catalog],[{...event,body:JSON.stringify({...prior,cancelled:true})},draft,'QA_A','2040-01-02',catalog],[event,draft,'QA_A','2040-01-02',{...catalog,revision:'changed'}]])assert.throws(()=>m.applyActivityScope(e,d,s,date,c),{name:'Error'});
});
test('retaining/discarding one scope draft cannot delete another activity or homework draft',()=>{
 const other={...draft,activityId:randomUUID()},plan={titles:['DT'],homeworkDraft:{items:[],scope:null,actions:[],due:'',noHomework:false},activityScopeDrafts:[other]};
 const added=m.mergeActivityScopeDraft(plan,draft.activityId,draft);assert.deepEqual(added.activityScopeDrafts,[other,draft]);assert.deepEqual(added.homeworkDraft,plan.homeworkDraft);assert.deepEqual(m.mergeActivityScopeDraft(added,draft.activityId,null),plan);
 assert.throws(()=>m.mergeActivityScopeDraft(plan,randomUUID(),draft),{name:'Error'});assert.throws(()=>m.activityScopeDraftsSchema.parse([draft,draft]),{name:'ZodError'});
});
test('real classroom handlers retain one revised activity and reject stale/foreign scope writes',async()=>{
 const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
 globalThis.__scopeEnv={DB:{prepare(q){return {bind(...v){return {async first(){return sql.prepare(q).get(...v)||null;},async all(){return {results:sql.prepare(q).all(...v)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...v).changes)}};}};}};}}};
 globalThis.__scopeHeaders=new Headers({'oai-authenticated-user-email':'scope-test@example.invalid'});
 const bundle=await build({stdin:{contents:"export * as api from './app/api/classroom/route';export {owner} from './lib/server';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[syntheticRosterPlugin,{name:'private-runtime',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'fixture'}));b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},x=>({contents:x.path==='env'?'export const env=globalThis.__scopeEnv':x.path==='headers'?'export async function headers(){return globalThis.__scopeHeaders}':'export function redirect(){throw new Error("redirect")}' }));}}]});
 writeFileSync('.sites-runtime/activity-scope-27b335/api-test.mjs',bundle.outputFiles[0].text);const {api,owner}=await import('../.sites-runtime/activity-scope-27b335/api-test.mjs'),who=await owner();
 const cat={...catalog,assignments:[{studentId:'S001',bookId:'QA_BOOK',slot:1}]};sql.prepare('INSERT INTO spt_sheet_snapshots(id,owner,class_date,content_hash,body,observed_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),who,'2040-01-02','QA',JSON.stringify({tracker:{resolvedCatalog:cat}}),'2040-01-02T00:00:00Z');
 const original={...m.task('DT','2040-01-02'),state:'working',attempted:'p.45~48',note:'PRIVATE',timing:{assignedAt:'2040-01-02T01:00:00.000Z',stoppedAt:'',visitedAt:'',revisitAt:''}};
 const p={id:randomUUID(),entityId:randomUUID(),studentId:'S001',date:'2039-12-31',kind:'activity',baseId:'',data:original};
 const send=v=>api.POST(new Request('https://spt.example/api/classroom',{method:'POST',headers:{'content-type':'application/json',origin:'https://spt.example'},body:JSON.stringify(v)}));
 assert.equal((await send(p)).status,200);const get=async()=> (await (await api.GET(new Request('https://spt.example/api/classroom?entity='+p.entityId))).json()).ledger;
 const first=(await get())[0],edit={...draft,activityId:p.entityId,baseRevisionId:p.id},next=m.applyActivityScope(first,edit,'S001','2040-01-02',cat),request={...p,id:randomUUID(),baseId:p.id,data:next};
 assert.equal((await send(request)).status,200);assert.equal((await send(request)).status,200);const rows=await get();assert.equal(rows.length,2);assert.deepEqual(JSON.parse(rows[0].body),original);assert.deepEqual(JSON.parse(rows[1].body),next);assert.equal(rows[1].class_date,p.date);assert.equal(rows[1].base_revision_id,p.id);
 assert.equal((await send({...request,id:randomUUID()})).status,409);assert.equal((await send({...request,id:randomUUID(),baseId:request.id,studentId:'S002'})).status,409);
 const changed={...scope,catalogRevision:'STALE'};assert.equal((await send({...request,id:randomUUID(),baseId:request.id,data:{...next,scope:changed,range:m.scopeText(changed)}})).status,409);
 // EX-03: a pending conflict is retainable, not a valid applied activity.
 const pendingScope={...scope,pageRanges:[{start:50,end:59}],excludedPages:[43]},pendingDraft={...edit,scope:pendingScope};
 const plan={id:randomUUID(),entityId:'plan:S001:2040-01-02',studentId:'S001',date:'2040-01-02',kind:'plan',baseId:'',data:{titles:['DT'],activityScopeDrafts:[pendingDraft]}};
 const planResponse=await send(plan);assert.equal(planResponse.status,200);
 const retainedPlan=await (await api.GET(new Request('https://spt.example/api/classroom?entity='+plan.entityId))).json();assert.deepEqual(JSON.parse(retainedPlan.ledger[0].body).activityScopeDrafts,[pendingDraft]);
 assert.equal((await send({...request,id:randomUUID(),baseId:request.id,data:{...next,scope:pendingScope,range:m.scopeText(pendingScope)}})).status,400);assert.equal((await get()).length,2);
 const data={ledger:[first],sessions:[],events:[],captures:[],connected:false};const review={...m.blankCloseout,progress:'kept',noHomework:true,confirmed:true,evidenceBasis:m.closeoutEvidenceBasis('S001','2040-01-02',data)};
 assert.equal(m.closeoutCurrent(review,m.closeoutEvidenceBasis('S001','2040-01-02',data)),true);assert.equal(m.closeoutCurrent(review,m.closeoutEvidenceBasis('S001','2040-01-02',{...data,ledger:[rows[1]]})),false);
 for(const table of ['spt_sessions','spt_entries','spt_captures','spt_sheet_receipts'])assert.equal(sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);sql.close();
});

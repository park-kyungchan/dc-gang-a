import {syntheticRosterPlugin} from './fixtures/synthetic-roster-plugin.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {build} from 'esbuild';
const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
let afterGroupRead=null;
globalThis.__hvEnv={DB:{prepare(q){return {bind(...v){return {async first(){const row=sql.prepare(q).get(...v)||null;if(q.startsWith('SELECT body FROM spt_class_events')&&q.includes("json_extract(body,'$.havruta.groupId')")&&afterGroupRead){const fn=afterGroupRead;afterGroupRead=null;fn();}return row;},async all(){return {results:sql.prepare(q).all(...v)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...v).changes)}};}};}};}}};globalThis.__hvHeaders=new Headers({'oai-authenticated-user-email':'havruta-api@example.invalid'});
const buildResult=await build({stdin:{contents:"export * as api from './app/api/classroom/route';export {owner} from './lib/server';export * from './lib/classroom';export * from './lib/havruta';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[syntheticRosterPlugin,{name:'private-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'test'}));b.onResolve({filter:/^next\/navigation$/},()=>({path:'nav',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},x=>({contents:x.path==='env'?'export const env=globalThis.__hvEnv':x.path==='headers'?'export async function headers(){return globalThis.__hvHeaders}':'export function redirect(){throw new Error("redirect")}' }));}}]});mkdirSync('.sites-runtime/havruta-27b335',{recursive:true});writeFileSync('.sites-runtime/havruta-27b335/api-test.mjs',buildResult.outputFiles[0].text);const m=await import('../.sites-runtime/havruta-27b335/api-test.mjs'),who=await m.owner(),date='2040-01-02';
const send=p=>m.api.POST(new Request('https://spt.example/api/classroom',{method:'POST',headers:{origin:'https://spt.example','content-type':'application/json'},body:JSON.stringify(p)}));
function fixture(){const members=['S001','S002','S003'].map(studentId=>({studentId,activityId:randomUUID()})),h={version:1,groupId:randomUUID(),date,members,problem:{kind:'teacher_issued'},review:null};return members.map(v=>({id:randomUUID(),entityId:v.activityId,studentId:v.studentId,date,kind:'activity',baseId:'',data:{...m.task('하브루타',date),havruta:h}}));}
test('real API retains each member, checks teacher decision/current work and preserves retries',async()=>{
 const batch=fixture();for(const p of batch)assert.equal((await send(p)).status,200);const a=batch[0];assert.equal((await send(a)).status,200);
 assert.equal((await send({...a,id:randomUUID(),baseId:a.id,data:{...a.data,state:'done'}})).status,409);
 const passed={...a,id:randomUUID(),baseId:a.id,data:{...a.data,...m.havrutaStatePatch(a.data,'done')}};assert.equal((await send(passed)).status,200);
 assert.equal((await send({...passed,id:randomUUID(),data:{...passed.data,range:'stale'}})).status,409);
 const scoped={...passed,id:randomUUID(),baseId:passed.id,data:{...passed.data,range:'new teacher problem'}};assert.equal((await send(scoped)).status,200);assert.equal(m.havrutaState(scoped.data),'check');
 assert.equal((await send({...scoped,id:randomUUID(),baseId:scoped.id,data:{...scoped.data,havruta:undefined}})).status,409);
 const rows=(await (await m.api.GET(new Request('https://spt.example/api/classroom'))).json()).ledger;assert.equal(rows.filter(e=>e.student_id==='S002').map(e=>JSON.parse(e.body))[0].havruta.review,null);
});
test('manifest consensus is checked inside the write, not only a pre-read',async()=>{
 const batch=fixture(),input=batch[1],raced=batch[0],alternate={...raced.data,havruta:{...raced.data.havruta,members:raced.data.havruta.members.slice(0,2)}};
 afterGroupRead=()=>sql.prepare('INSERT INTO spt_class_events(id,owner,entity_id,student_id,class_date,kind,body,created_at,schema_version) VALUES(?,?,?,?,?,?,?,?,?)').run(raced.id,who,raced.entityId,raced.studentId,date,'activity',JSON.stringify(m.validateClass('activity',alternate,date)),new Date().toISOString(),1);
 assert.equal((await send(input)).status,409,'a different first manifest can arrive after pre-read');assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events WHERE entity_id=?').get(input.entityId).n,0);
});
test('ordinary note edits cannot leave a pass attached while reopening work',async()=>{
 const [a]=fixture();assert.equal((await send(a)).status,200);const pass={...a,id:randomUUID(),baseId:a.id,data:{...a.data,...m.havrutaStatePatch(a.data,'done')}};assert.equal((await send(pass)).status,200);
 assert.equal((await send({...pass,id:randomUUID(),baseId:pass.id,data:{...pass.data,state:'working'}})).status,409);
});

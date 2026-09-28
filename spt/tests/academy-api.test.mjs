// Actual Worker handlers + private in-memory DB; native HTTP is an explicit fake.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {api,sql,sign,req,good} from './pilot-contract.mjs';
sign();
const owner=await api.server.owner(),date='2040-01-02',studentId='S004';
const environment=globalThis.__sptEnv;
Object.assign(environment,{SPT_ACADEMY_OWNER_KEY:owner,SPT_ACADEMY_TOKEN:'SYNTHETIC_INTERNAL_ONLY',SPT_ACADEMY_URL:'http://127.0.0.1:4182/academy'});
const basis=api.reviewModel.closeoutEvidenceBasis(studentId,date,{sessions:[],events:[],ledger:[]});
const close={...api.classModel.blankCloseout,progress:'Internal detailed source scope',noHomework:true,next:'PRIVATE FOLLOW-UP MUST NOT LEAK',diary:{progress:'Reviewed public progress',homework:'없음',classMemo:''},evidenceBasis:basis};
const save=async(data,baseId='')=>{const id=randomUUID();await good(await api.classroom.POST(req('/api/classroom',{id,studentId,date,kind:'closeout',entityId:'closeout:'+studentId+':'+date,baseId,data})));return id;};
const post=p=>api.academy.POST(req('/api/academy',{studentId,date,...p}));
const fetchBefore=globalThis.fetch;const calls=[];
globalThis.fetch=async(url,init)=>{assert.equal(url,environment.SPT_ACADEMY_URL);assert.equal(init.headers.Authorization,'Bearer SYNTHETIC_INTERNAL_ONLY');const p=JSON.parse(init.body);calls.push(p);return Response.json({state:p.action==='preview'?'prepared':'verified',entryId:p.entryId,requestId:p.requestId||randomUUID(),synthetic:true});};
try{
 let draft,confirmed;
 await test('a client confirmation or public field payload cannot bypass the stored review',async()=>{
  draft=await save(close);const r=await post({action:'preview',entryId:draft,confirmed:true,fields:{progress:'FORGED'}});assert.equal(r.status,409);assert.equal(calls.length,0);
 });
 await test('native source is an exact current stored revision containing public fields only',async()=>{
  confirmed=await save({...close,confirmed:true},draft);
  const source=await good(await api.academy.GET(new Request('https://spt.example/api/academy?sourceId='+confirmed)));
  assert.equal(source.ownerKey,owner);assert.equal(source.source.entryId,confirmed);assert.equal(source.source.studentId,studentId);assert.equal(source.source.date,date);assert.equal(source.source.fields.progress,close.diary.progress);assert.ok(!JSON.stringify(source).includes('PRIVATE'));
  const got=await good(await post({action:'preview',entryId:confirmed,fields:{progress:'FORGED'}}));assert.equal(got.state,'prepared');assert.deepEqual(Object.keys(calls[0]).sort(),['action','entryId']);
 });
 await test('wrong student/date and another account cannot consume the reviewed source',async()=>{
  const count=calls.length;assert.equal((await post({action:'preview',entryId:confirmed,studentId:'S002'})).status,409);assert.equal((await post({action:'preview',entryId:confirmed,date:'2040-01-03'})).status,409);
  sign('SYNTHETIC_OTHER');assert.equal((await api.academy.GET(new Request('https://spt.example/api/academy?sourceId='+confirmed))).status,409);sign();assert.equal(calls.length,count);
 });
 await test('changed activity evidence blocks a stale academy write while retaining the old review',async()=>{
  const id=randomUUID();await good(await api.classroom.POST(req('/api/classroom',{id,entityId:randomUUID(),studentId,date,kind:'activity',baseId:'',data:api.classModel.task('SYNTHETIC newer activity',date)})));
  const count=calls.length;assert.equal((await post({action:'apply',entryId:confirmed,requestId:randomUUID()})).status,409);assert.equal(calls.length,count);assert.ok(sql.prepare('SELECT id FROM spt_class_events WHERE id=?').get(confirmed));
 });
 await test('structured scope is validated against the observed catalog; later state revisions preserve old scope',async()=>{
  const c={revision:'QA_REV',books:[{id:'QA_BOOK',name:'Synthetic source book',code:'descriptor',source:'synthetic',version:'1',start:null,end:null,excluded:[]}],units:[{id:'QA_U',bookId:'QA_BOOK',parentId:'',level:1,kind:'UNIT',name:'Synthetic unit',notation:'03-1',start:42,end:49,order:1,source:'synthetic'}],assignments:[{studentId,bookId:'QA_BOOK',slot:1}]};
  const snap={tracker:{resolvedCatalog:c}};const insert=()=>sql.prepare('INSERT INTO spt_sheet_snapshots(id,owner,class_date,content_hash,body,observed_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),owner,date,randomUUID(),JSON.stringify(snap),new Date().toISOString());insert();
  const scope=api.curriculumModel.makeScope(c,studentId,'QA_BOOK',['QA_U']),entityId=randomUUID(),id=randomUUID(),body={...api.classModel.task('DT',date),scope,range:api.curriculumModel.scopeText(scope)};
  await good(await api.classroom.POST(req('/api/classroom',{id,entityId,studentId,date,kind:'activity',baseId:'',data:body})));
  c.revision='NEW_CATALOG';insert();
  await good(await api.classroom.POST(req('/api/classroom',{id:randomUUID(),entityId,studentId,date,kind:'activity',baseId:id,data:{...body,state:'working'}})));
  const r=await api.classroom.POST(req('/api/classroom',{id:randomUUID(),entityId:randomUUID(),studentId,date,kind:'activity',baseId:'',data:body}));assert.equal(r.status,409);
 });
}finally{globalThis.fetch=fetchBefore;}

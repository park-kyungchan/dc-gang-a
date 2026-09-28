import {syntheticRosterPlugin} from './fixtures/synthetic-roster-plugin.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFileSync,readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const built=await build({stdin:{contents:"export * from './lib/classroom';export * from './lib/curriculum';export * from './lib/diary-draft';export * from './lib/homework';export * from './lib/closeout-review';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
mkdirSync('.sites-runtime/homework-next-use-27b335',{recursive:true});
writeFileSync('.sites-runtime/homework-next-use-27b335/domain-test.mjs',built.outputFiles[0].text);
const m=await import('../.sites-runtime/homework-next-use-27b335/domain-test.mjs');
const scope={bookId:'QA_BOOK',bookLabel:'초5-2 · 가우스 · 본교재 · 2권',catalogRevision:'QA_REV',unitIds:[],unitLabels:[],notation:'',startKnowledge:'known',startPage:null,endPage:null,detail:'',pageRanges:[{start:46,end:69}],excludedPages:[63,64]};
const item={id:'c1d69598-e2a6-4df9-9848-23b9971c6f63',scope,actions:['개념 예습','예습영상 촬영']};
test('one shared scope retains exact disjoint ranges and explicit excluded pages',()=>{
 const got=m.scopeSchema.parse(scope);assert.deepEqual(got.pageRanges,[{start:46,end:69}]);assert.deepEqual(got.excludedPages,[63,64]);
 assert.match(m.scopeText(got),/46~69/);assert.match(m.scopeText(got),/제외.*63~64/);
 const disjoint={...scope,pageRanges:[{start:45,end:48},{start:52,end:53}],excludedPages:[]};assert.doesNotMatch(m.scopeText(m.scopeSchema.parse(disjoint)),/45~53|49/);
});
test('structured homework survives the actual closeout validator without confirming or departing',()=>{
 const plan={items:[item]};const homework='초5-2 가우스 2권 p.46~69 (제외 p.63~64): 개념 예습·예습영상 촬영';
 const got=m.validateClass('closeout',{...m.blankCloseout,homework,due:'2040-01-04',homeworkPlan:plan},'2040-01-02');
 assert.deepEqual(got.homeworkPlan,plan);assert.equal(got.confirmed,false);assert.equal(got.departedAt,'');
});
test('reopened homework edit retains its original item identity instead of adding a duplicate',()=>{
 const draft={items:[item],scope,actions:item.actions,due:'2040-01-04',noHomework:false,editingId:item.id};
 const got=m.validateClass('plan',{titles:[],homeworkDraft:draft},'2040-01-02');assert.equal(got.homeworkDraft.editingId,item.id);assert.equal(got.homeworkDraft.items.length,1);
});
test('invalid exclusions, overlapping ranges and conflicting legacy range owners are rejected',()=>{
 // Positive case first so validation cannot pass because the new shape is unknown.
 assert.ok(m.scopeSchema.parse(scope));
 for(const change of [{excludedPages:[70]},{pageRanges:[{start:46,end:69},{start:68,end:72}]},{startPage:46,endPage:69}])assert.throws(()=>m.scopeSchema.parse({...scope,...change}),{name:'ZodError'});
});

test('the existing bridge supplies schedule and confirmed-makeup source facts without writes',()=>{
 const context=vm.createContext({});vm.runInContext(readFileSync('integrations/tracker/SPTBridge.gs','utf8'),context);
 assert.equal(typeof context.spbSchedule_,'function','snapshot needs its missing schedule reader');
 context.pkHash_=v=>JSON.stringify(v);context.spbIso_=v=>v;
 context.spbRequire_=(v,_code,message)=>assert.ok(v,message);
 context.spbGrid_=sheet=>({values:sheet.rows});
 const sheets={
  '박경찬_DB_수업':{rows:[['수업ID','수업일','요일','수업반','부','시작','종료','상태'],['L','2040-01-04','수','QA반','1부','15:00','17:30','취소']]},
  '박경찬_DB_보강':{rows:[['보강ID','결석ID','학생ID','학생명','보강일','시작','종료','진행상태','확정상태'],['M','A','QA_A','Synthetic','2040-01-03','15:00','17:30','예정','확정']]}
 };
 Object.values(sheets).forEach(s=>s.getLastRow=()=>s.rows.length);
 const before=JSON.stringify(sheets),got=context.spbSchedule_({getSheetByName:n=>sheets[n],getSpreadsheetTimeZone:()=> 'Asia/Seoul'});
 assert.equal(got.lessons[0].status,'취소');assert.equal(got.makeups[0].studentId,'QA_A');assert.equal(got.makeups[0].confirmation,'확정');assert.equal(JSON.stringify(sheets),before);assert.doesNotMatch(JSON.stringify(got),/Synthetic|상담메모/);
 sheets['박경찬_DB_수업'].rows[0][1]='wrong date column';assert.throws(()=>context.spbSchedule_({getSheetByName:n=>sheets[n],getSpreadsheetTimeZone:()=> 'Asia/Seoul'}),/열 구조/);
});

const student={id:'QA_A',active:true};
const schedule=()=>({readAt:'2040-01-02T10:00:00Z',profileSource:{profiles:[{id:'QA_A',revision:'P1',status:'재원',className:'QA반',part:'1부',days:'월·수',firstDate:'2039-01-01'}]},schedule:{revision:'SC1',lessons:[],makeups:[]}});
test('next-registered lesson honors cancellation and confirmed makeup, never asks routine dates',()=>{
 const s=schedule();assert.equal(m.nextHomeworkDue(student,'2040-01-02',s).date,'2040-01-04');
 s.schedule.lessons=[{id:'L',date:'2040-01-04',className:'QA반',part:'1부',status:'취소'}];assert.equal(m.nextHomeworkDue(student,'2040-01-02',s).date,'2040-01-09');
 s.schedule.makeups=[{id:'M',studentId:'QA_A',date:'2040-01-03',status:'예정',confirmation:'확정'}];const due=m.nextHomeworkDue(student,'2040-01-02',s);assert.equal(due.date,'2040-01-03');assert.ok(due.sourceRefs.includes('makeup:M'));
 s.schedule.makeups[0].confirmation='미확정';assert.equal(m.nextHomeworkDue(student,'2040-01-02',s).date,null);
 assert.equal(m.nextHomeworkDue(student,'2040-01-02',{}).date,null);
});
test('book defaults exclude GaussPlus and do not guess an unknown book',()=>{
 assert.deepEqual(m.defaultHomeworkActions(scope.bookLabel),item.actions);assert.deepEqual(m.defaultHomeworkActions('다빈치'),['문제 풀이']);assert.deepEqual(m.defaultHomeworkActions('가우스플러스'),[]);assert.deepEqual(m.defaultHomeworkActions('Unknown'),[]);
});
test('a typed homework date before its lesson is rejected without repairing the literal value',()=>{
 const c={...m.blankCloseout,homeworkPlan:{items:[item]},homework:m.homeworkText({items:[item]}),due:'0105-01-04'};
 assert.throws(()=>m.validateClass('closeout',c,'2040-01-02'),/기한/);assert.equal(c.due,'0105-01-04');
});
test('fixed parent consumer only uses explicitly reviewed activities and preserves homework exclusions',()=>{
 const e={id:'a1',student_id:'QA_A',kind:'activity',body:JSON.stringify({...m.task('클리닉','2040-01-02'),state:'working',scope,attempted:'p.45~48',note:'PRIVATE'})};
 const c={...m.blankCloseout,homeworkPlan:{items:[item]},homework:m.homeworkText({items:[item]}),due:'2040-01-05'};
 assert.throws(()=>m.parentInputFromClass('QA_A','2040-01-02',[e],[],c,'C1'),/선택/);
 const input=m.parentInputFromClass('QA_A','2040-01-02',[e],['a1'],c,'C1'),p=m.previewParentDiary(input);
 assert.match(p.fields.progress,/45~48/);assert.doesNotMatch(p.fields.progress,/49|배정|PRIVATE/);assert.match(p.fields.homework,/1\/5/);assert.match(p.fields.homework,/제외: p\.63~64/);assert.match(p.fields.homework,/예습영상 촬영/);assert.equal(input.homework.due,'2040-01-05');
 assert.throws(()=>m.parentInputFromClass('QA_B','2040-01-02',[e],['a1'],c,'C1'),/근거/);
 e.body=JSON.stringify({...JSON.parse(e.body),state:'assigned'});assert.throws(()=>m.parentInputFromClass('QA_A','2040-01-02',[e],['a1'],c,'C1'),/근거/);
});

test('reviewed transcript amendments invalidate earlier structured homework and public derivations',()=>{
 const source={id:randomUUID(),session_id:randomUUID(),kind:'transcript',body:JSON.stringify({text:'SYNTHETIC teacher amendment'})};
 const draft={id:randomUUID(),session_id:source.session_id,kind:'ai_draft',body:JSON.stringify({text:JSON.stringify({protocol:'spt.conversation-draft.v1',basisEntryIds:[source.id],candidates:[{id:'h1',kind:'homework',text:'새로 검토한 숙제',attribution:'teacher_statement',evidenceIds:[source.id],uncertainty:''}]})})};
 const events=[source,draft],edits=m.reviewProposal(draft,events).edits;edits.due='2040-01-05';
 const c={...m.blankCloseout,homeworkPlan:{items:[item]},homework:m.homeworkText({items:[item]}),due:'2040-01-04',diary:{progress:'원래 진도',homework:'원래 숙제',classMemo:'기존 안내'}};
 const next=m.applyReviewedDraft(draft,events,c,edits,'B');assert.equal(next.homeworkPlan,undefined);assert.equal(next.diary.homework,'');assert.equal(next.diary.classMemo,'기존 안내');assert.equal(next.confirmed,false);assert.equal(m.validateClass('closeout',next,'2040-01-02').homework,'새로 검토한 숙제');
});

test('actual classroom API persists structured scope, exact retry and CAS without academic/recording effects',async()=>{
 const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
 globalThis.__homeworkEnv={DB:{prepare(q){return {bind(...v){return {async first(){return sql.prepare(q).get(...v)||null;},async all(){return {results:sql.prepare(q).all(...v)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...v).changes)}};}};}};}}};
 globalThis.__homeworkHeaders=new Headers({'oai-authenticated-user-email':'homework-test@example.invalid'});
 const buildApi=await build({stdin:{contents:"export * as api from './app/api/classroom/route';export {owner} from './lib/server';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[syntheticRosterPlugin,{name:'private-runtime',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'fixture'}));b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},x=>({contents:x.path==='env'?'export const env=globalThis.__homeworkEnv':x.path==='headers'?'export async function headers(){return globalThis.__homeworkHeaders}':'export function redirect(){throw new Error("redirect")}' }));}}]});
 writeFileSync('.sites-runtime/homework-next-use-27b335/api-test.mjs',buildApi.outputFiles[0].text);const {api,owner}=await import('../.sites-runtime/homework-next-use-27b335/api-test.mjs'),who=await owner();
 const catalog={revision:'QA_REV',books:[{id:'QA_BOOK',name:scope.bookLabel,code:'QA',source:'synthetic',version:'1',start:1,end:90,excluded:[]}],units:[],assignments:[{studentId:'S001',bookId:'QA_BOOK',slot:1}]};
 sql.prepare('INSERT INTO spt_sheet_snapshots(id,owner,class_date,content_hash,body,observed_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),who,'2040-01-02','QA',JSON.stringify({tracker:{resolvedCatalog:catalog}}),'2040-01-02T00:00:00Z');
 const payload={id:randomUUID(),entityId:'closeout:S001:2040-01-02',studentId:'S001',date:'2040-01-02',kind:'closeout',baseId:'',data:{...m.blankCloseout,homeworkPlan:{items:[item]},homework:m.homeworkText({items:[item]}),due:'2040-01-04'}};
 const send=p=>api.POST(new Request('https://spt.example/api/classroom',{method:'POST',headers:{'content-type':'application/json',origin:'https://spt.example'},body:JSON.stringify(p)}));
 const first=await send(payload);assert.equal(first.status,200,await first.clone().text());
 const read=await (await api.GET(new Request('https://spt.example/api/classroom?entity='+payload.entityId))).json();assert.equal(read.ledger.length,1);assert.deepEqual(JSON.parse(read.ledger[0].body).homeworkPlan,{items:[item]});
 assert.equal((await send(payload)).status,200);assert.equal((await send({...payload,id:randomUUID(),data:{...payload.data,due:'2040-01-05'}})).status,409);
 const next={...payload,id:randomUUID(),baseId:payload.id,data:{...payload.data,due:'2040-01-05'}};assert.equal((await send(next)).status,200);assert.equal((await send({...next,id:randomUUID(),baseId:payload.id})).status,409);
 const wrong={...item,scope:{...scope,catalogRevision:'STALE'}};assert.equal((await send({...next,id:randomUUID(),baseId:next.id,data:{...next.data,homeworkPlan:{items:[wrong]},homework:m.homeworkText({items:[wrong]})}})).status,409);
 globalThis.__homeworkHeaders=new Headers({'oai-authenticated-user-email':'other@example.invalid'});assert.equal((await (await api.GET(new Request('https://spt.example/api/classroom?entity='+payload.entityId))).json()).ledger.length,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events').get().n,2);for(const table of ['spt_sessions','spt_captures','spt_entries','spt_sheet_receipts'])assert.equal(sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);sql.close();
});

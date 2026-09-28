// All identities, classes and Sheet responses below are local synthetic fixtures.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {indexedDB} from 'fake-indexeddb';
import {api,sql,sign,req,good,test} from './pilot-contract.mjs';
const bundled=await build({stdin:{contents:"export * from './lib/roster';export * from './lib/handoff';export * from './lib/card-swipe'",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const model=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
sign('roster-fixture');const owner=await api.server.owner(),date='2026-09-23';
const snapshot={schema:1,spreadsheetId:'1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg',date,readAt:'',profileSource:{profiles:[]},mainSource:{rows:[]},tracker:{students:[],events:[],attendance:[],catalog:{}}};
for(let i=1;i<=13;i++){const id='X'+String(i).padStart(3,'0'),name='가상학생 '+i;snapshot.profileSource.profiles.push({id,name,status:'재원',days:'수요일, 금요일',firstDate:'2026-09-01',time:'15:00–17:30',part:'1부',book1:'합성 교재 '+i,book2:'',sourceRow:i+13,revision:'r1',cells:[]});snapshot.mainSource.rows.push({sourceRow:i*5,name,grade:'합성',cells:[]});snapshot.tracker.students.push({studentId:id,revision:'r1',factsBasis:'f1',latestReview:null});}
const mapping=i=>({studentId:snapshot.profileSource.profiles[i].id,name:snapshot.profileSource.profiles[i].name,profileRow:i+14,mainRow:(i+1)*5});
let revision='',commits=0;const originalFetch=globalThis.fetch;
globalThis.__sptEnv.SPT_SHEET_BRIDGE_URL='https://script.google.com/macros/s/SYNTHETIC-ONLY/exec';globalThis.__sptEnv.SPT_SHEET_BRIDGE_KEY='LOCAL-ONLY';
globalThis.fetch=async(_,init)=>{const p=JSON.parse(init.body);assert.equal(p.payload.actorKey,owner);if(p.action==='snapshot')return Response.json({ok:true,snapshot});commits++;throw new Error('Unexpected learning write');};
const post=p=>api.sheet.POST(req('/api/sheet',{date,...p}));
const preview=async()=>good(await post({action:'preview'}));
const connect=async(mappings)=>{const p=await preview(),reply=await good(await post({action:'connect',confirmed:true,snapshotHash:p.hash,mappings,rosterRevision:revision}));revision=reply.rosterRevision;};
const read=()=>api.notebook.GET(new Request('https://spt.example/api/notebook?date='+date)).then(good);
try{
 await test('6 then 12 students are source-confirmed; additions preserve earlier mappings and no learning writes occur',async()=>{
  await connect(Array.from({length:6},(_,i)=>mapping(i)));assert.equal((await read()).roster.filter(s=>s.source).length,6);
  await connect(Array.from({length:6},(_,i)=>mapping(i+6)));const data=await read();assert.equal(data.roster.filter(s=>s.source).length,12);assert.equal(JSON.parse(sql.prepare('SELECT mappings FROM spt_sheet_settings WHERE owner=?').get(owner).mappings).length,12);assert.equal(commits,0);
  const scheduled=api.model.scheduled(date,data.roster).filter(s=>s.source);assert.equal(scheduled.length,12);assert(scheduled.every(s=>!s.days.includes(0)));
  await connect([mapping(12)]);assert.equal((await read()).roster.filter(s=>s.source).length,13); // 12 is a classroom goal, not total roster limit.
 });
 await test('new student identity works across session/classroom/handoff/deep link/report export and rejects an unknown source ID',async()=>{
  const id=randomUUID(),studentId='X012';await good(await api.notebook.POST(req('/api/notebook',{action:'create',id,studentId,date,title:'SYNTHETIC',purpose:'lesson'})));
  const close={progress:'LOCAL ONLY',homework:'',due:'',noHomework:true,next:'',confirmed:true,departedAt:''};const cid=randomUUID();await good(await api.classroom.POST(req('/api/classroom',{id:cid,studentId,date,entityId:`closeout:${studentId}:${date}`,kind:'closeout',baseId:'',data:close})));
  const data=await read(),ledger=(await good(await api.classroom.GET(new Request('https://spt.example/api/classroom')))).ledger;
  assert.equal(JSON.parse(model.trackerHandoff(studentId,date,ledger,data.roster)).studentName,'가상학생 12');assert.equal(model.notebookDestination(`?student=${studentId}&date=${date}`,data.roster).studentId,studentId);
  assert(api.classModel.exportClass(date,'1부',ledger,data.sessions,data.events,data.captures,data.roster).includes('가상학생 12'));
  assert.equal((await api.notebook.POST(req('/api/notebook',{action:'create',id:randomUUID(),studentId:'UNKNOWN',date,title:'X'}))).status,400);
 });
 await test('stale connection and shared main row reject without replacing catalog or mappings',async()=>{
  const p=await preview();assert.equal((await post({action:'connect',confirmed:true,snapshotHash:p.hash,mappings:[mapping(0)],rosterRevision:''})).status,409);
  snapshot.profileSource.profiles.push({...snapshot.profileSource.profiles[0],id:'DUPLICATE',sourceRow:99});const fresh=await preview();assert.equal((await post({action:'connect',confirmed:true,snapshotHash:fresh.hash,mappings:[{studentId:'DUPLICATE',name:'가상학생 1',profileRow:99,mainRow:5}],rosterRevision:revision})).status,409);assert.equal((await read()).rosterRevision,revision);snapshot.profileSource.profiles.pop();
 });
 await test('catalog and bindings roll back atomically when revision storage fails',async()=>{
  const prepare=globalThis.__sptEnv.DB.prepare;globalThis.__sptEnv.DB.prepare=query=>{if(!query.startsWith('INSERT INTO spt_roster_revisions'))return prepare(query);return {bind:()=>({run:async()=>{throw new Error('synthetic disk failure')}})};};
  try{const p=await preview();assert.equal((await post({action:'connect',confirmed:true,snapshotHash:p.hash,mappings:[mapping(0)],rosterRevision:revision})).status,500);}finally{globalThis.__sptEnv.DB.prepare=prepare;}
  assert.equal((await read()).rosterRevision,revision);
 });
 await test('withdrawal excludes future schedule but preserves offline queued records and other active students sync when old source row disappears',async()=>{
  globalThis.indexedDB=indexedDB;const before=await read(),box=new api.DeviceOutbox(owner);await box.read();await box.cache('roster',{students:before.roster,revision});const sid=randomUUID(),p={action:'create',id:sid,studentId:'X001',date,title:'QUEUED BEFORE WITHDRAWAL'};await box.enqueue(sid,'/api/notebook',p);
  snapshot.profileSource.profiles[0].status='퇴원';await connect([mapping(0)]);const data=await read();assert.equal(data.roster.find(s=>s.id==='X001').active,false);assert(!api.model.scheduled(date,data.roster).some(s=>s.id==='X001'));
  await good(await api.notebook.POST(req('/api/notebook',p)));await good(await api.notebook.POST(req('/api/notebook',p)));assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_sessions WHERE id=?').get(sid).n,1);
  const reopened=new api.DeviceOutbox(owner);await reopened.read();assert(reopened.pending.some(j=>j.payload?.id===sid));assert.equal(reopened.cached('roster').students.find(s=>s.id==='X001').name,'가상학생 1');assert.equal(api.projectData({...api.emptyData,roster:data.roster},reopened.items,date).roster.find(s=>s.id==='X001').active,false);
  snapshot.profileSource.profiles.shift();snapshot.mainSource.rows.shift(); // historical identity remains, no learning write
  // Unconfirmed local closeout prevents real write in this test.
  sql.prepare('DELETE FROM spt_class_events WHERE owner=?').run(owner);
  await good(await post({action:'sync'}));assert.equal(commits,0);
 });
 await test('ambiguous status/day/date never fabricates a scheduled class',()=>{
  for(const fields of [{days:'미정(월 가능)'},{days:'월요일 제외'},{firstDate:''},{firstDate:'2026-02-30'},{status:'휴원'},{status:''}]){const p={...snapshot.profileSource.profiles[0],...fields};const source={...snapshot,profileSource:{profiles:[p]}};const roster=model.mergeRoster([],source,[{studentId:p.id,mainRow:10,profileRow:p.sourceRow}],'hash','now');assert.equal(api.model.scheduled('2026-09-23',roster).length,0);}
 });
 await test('catalog current/history exports retain confirmation source and account isolation',async()=>{
  const exported=async(view)=>{const response=await api.dataset.GET(new Request(`https://spt.example/api/dataset?from=${date}&to=${date}&view=${view}`));return (await response.text()).trim().split('\n').map(JSON.parse);};
  const current=await exported('current'),history=await exported('history');const catalogs=current.filter(r=>r.record_type==='roster_revision');assert.equal(catalogs.length,1);assert.equal(catalogs[0].id,revision);assert.equal(catalogs[0].catalog.students.find(s=>s.id==='X001').active,false);assert(history.filter(r=>r.record_type==='roster_revision').length>=4);assert.equal(current.at(-1).record_type,'export_complete');assert(!JSON.stringify(current).includes(owner));
  sign('different-roster-owner');assert(!(await read()).roster.some(s=>s.id.startsWith('X')));assert(!(await exported('history')).some(r=>r.record_type==='roster_revision'));sign('roster-fixture');
 });
 await test('long horizontal release deletes; short, reversed, vertical, cancelled context or disabled input never deletes',()=>{
  const make=()=>({id:1,x:350,y:20,base:0,width:340,revision:'original-card',axis:'pending',dx:0,dy:0});
  let d=make();assert(model.endCardSwipe(d,100,22,'original-card',false).remove);
  d=make();const short=model.endCardSwipe(d,270,22,'original-card',false);assert(!short.remove&&short.open);
  d=make();model.moveCardSwipe(d,100,20);assert(!model.endCardSwipe(d,345,20,'original-card',false).remove);
  d=make();model.moveCardSwipe(d,348,50);assert(!model.endCardSwipe(d,90,51,'original-card',false).remove);
  assert(!model.endCardSwipe(make(),100,22,'new-revision',false).remove);assert(!model.endCardSwipe(make(),100,22,'original-card',true).remove);
 });
}finally{globalThis.fetch=originalFetch;}

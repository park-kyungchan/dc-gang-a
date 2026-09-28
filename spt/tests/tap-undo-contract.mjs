// Only synthetic memory/SQLite data. Run: node --experimental-vm-modules tests/tap-undo-contract.mjs
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
const root=process.cwd(),read=p=>readFileSync(path.join(root,p),'utf8');
const strip=s=>stripTypeScriptTypes(s,{mode:'transform',disableExperimentalWarning:true});
const modules=new Map();
function mod(file){if(!modules.has(file))modules.set(file,new vm.SourceTextModule(strip(readFileSync(file,'utf8')),{identifier:file}));return modules.get(file);}
const model=mod(path.join(root,'lib/classroom.ts'));
await model.link((s,r)=>mod(path.resolve(path.dirname(r.identifier),s+'.ts')));await model.evaluate();
const cm=model.namespace,nm=modules.get(path.join(root,'lib/notebook.ts')).namespace,obs=modules.get(path.join(root,'lib/observation-cards.ts')).namespace,time=modules.get(path.join(root,'lib/activity-time.ts')).namespace;
const undo=mod(path.join(root,'lib/tap-undo.ts'));await undo.link(()=>{});await undo.evaluate();
const {tapPatch,matchesTap}=undo.namespace;
let count=0;async function check(name,fn){await fn();console.log('PASS',++count,name);}
const at='2026-09-09T09:00:00.000Z';
await check('completion second tap restores exact former state and all timing fields',()=>{
 const before={...cm.task('SYNTHETIC','2026-09-09'),state:'check',timing:time.scheduleVisit(time.assignedTiming(at),5,true,at)};
 const first=tapPatch(before,null,'done',{state:'done',timing:time.transitionTiming(before.timing,'done','2026-09-09T09:10:00.000Z')});
 const value={...before,...first.patch,range:'an unrelated field'};
 const second=tapPatch(value,first.undo,'done',{state:'assigned'});
 assert.deepEqual({...value,...second.patch},{...before,range:'an unrelated field'});assert.equal(second.undo,null);
});
await check('revisit undo restores prior signal, does not compute a fresh timestamp',()=>{
 const before={timing:time.scheduleVisit(time.assignedTiming(at),3,false,at)};
 const one=tapPatch(before,null,'visit',{timing:time.scheduleVisit(before.timing,5,true,'2026-09-09T09:02:00.000Z')});
 const two=tapPatch({...before,...one.patch},one.undo,'visit',{});assert.deepEqual(two.patch,before);
 assert.equal(matchesTap({timing:time.assignedTiming(at)},one.undo,'visit'),false);
});
// Deterministic scheduling for the exact production hook, including rapid repeated callbacks.
const panels=read('app/classroom-panels.tsx');const hook=panels.slice(panels.indexOf('function useForm<'),panels.indexOf('\nexport function Pick'));
let slots=[],cursor=0,effects=[],saves=[];
const hooks={tapPatch,matchesTap,useState(v){const i=cursor++;if(!(i in slots))slots[i]=v;return [slots[i],x=>slots[i]=typeof x==='function'?x(slots[i]):x];},useRef(v){const i=cursor++;if(!(i in slots))slots[i]={current:v};return slots[i];},useEffect(fn,deps){const i=cursor++,prev=slots[i];if(!prev||deps.some((v,j)=>v!==prev[j]))effects.push(fn);slots[i]=deps;}};
vm.createContext(hooks);vm.runInContext(strip(hook+'\nthis.form=useForm;'),hooks);
const render=(v,id)=>{cursor=0;effects=[];const result=hooks.form(v,async(data,base)=>saves.push({data,base}),e=>{throw e},id);effects.forEach(f=>f());return result;};
await check('fast double tap through same React callback returns to initial data',()=>{
 slots=[];saves=[];const data={confirmed:false,departedAt:'',homework:'p10'};const ui=render(data,'r0');
 ui[2]('confirm',{confirmed:true,departedAt:''});ui[2]('confirm',{confirmed:true,departedAt:''});
 assert.equal(saves.at(-1).data.confirmed,false);assert.equal(saves.at(-1).data.homework,'p10');
});
await check('own acknowledgement permits later remote update and clears stale undo',()=>{
 slots=[];saves=[];const initial={confirmed:false,homework:'p10'};let ui=render(initial,'r0');ui[2]('confirm',{confirmed:true});
 render({...initial,confirmed:true},'r1');const remote={confirmed:true,homework:'p20'};render(remote,'r2');ui=render(remote,'r2');
 assert.equal(ui[0].homework,'p20');assert.equal(ui[3]('confirm'),false);ui[1]({homework:'p21'});assert.equal(saves.at(-1).base,'r2');
});
await check('cancelled assignment retains evidence but does not count as current work',()=>{
 const t={...cm.task('SYNTHETIC','2026-09-09'),timing:time.assignedTiming(at),cancelled:true};const saved=cm.validateClass('activity',t,'2026-09-09');
 assert.equal(cm.isOpen(saved),false);assert.equal(saved.timing.assignedAt,at);assert.equal(cm.isOpen({...saved,cancelled:false}),true);
});
await check('exact assignment handler: repeated tap cancels/restores same ID; edited activity is preserved',async()=>{
 const log=[],recentRef={current:{}},ledgerRef={current:[]};
 const ac={Date,JSON,crypto,task:cm.task,assignedTiming:time.assignedTiming,date:'2026-09-09',recentRef,ledgerRef,assigning:{current:false},setRecent(){},save:async(kind,id,body,date,base)=>{log.push({id,body,base});ledgerRef.current=[{entity_id:id,id:randomUUID(),body:JSON.stringify(body)}];}};
 vm.createContext(ac);const start=panels.indexOf(' async function assign(');const finish=panels.indexOf('\n return ',start);
 vm.runInContext(strip(panels.slice(start,finish)),ac);await ac.assign('SYNTHETIC');await ac.assign('SYNTHETIC');await ac.assign('SYNTHETIC');
 assert.equal(new Set(log.map(x=>x.id)).size,1);assert.deepEqual(log.map(x=>x.body.cancelled),[false,true,false]);assert.equal(log[0].body.timing.assignedAt,log[2].body.timing.assignedAt);
 const row=ledgerRef.current[0];row.body=JSON.stringify({...JSON.parse(row.body),range:'later edited'});await ac.assign('SYNTHETIC');assert.notEqual(log.at(-1).id,log[0].id);assert.equal(log.at(-1).base,'');
});
await check('legacy queued payloads keep their original serialized shape',()=>{
 const {cancelled,...legacy}=cm.task('SYNTHETIC','2026-09-09');assert.equal('cancelled' in cm.validateClass('activity',legacy,'2026-09-09'),false);
});
await check('student review can finish without a parent draft; transfer still needs a message',()=>{
 const report={...cm.blankReport,summary:'Teacher reviewed this synthetic lesson',confirmed:true,basis:'B1'};
 assert.equal(cm.validateClass('report',report,'2026-09-09').confirmed,true);
 for(const patch of [{summary:''},{basis:''},{transferredAt:at}])assert.throws(()=>cm.validateClass('report',{...report,...patch},'2026-09-09'));
 const legacy={...report,parent:'Existing parent message',transferredAt:at};
 assert.equal(JSON.stringify(cm.validateClass('report',legacy,'2026-09-09')),JSON.stringify(legacy));
});
await check('parent-only work preserves internal review; changed notes or evidence require another check',()=>{
 const r={...cm.blankReport,summary:'Reviewed',needs:'One question',next:'Check next lesson'};
 const key=cm.reportCheckKey(r,'B1',true);
 assert.equal(cm.reportCheckKey({...r,parent:'New wording',transferredAt:at},'B1',true),key);
 for(const field of ['summary','needs','next','draft'])assert.notEqual(cm.reportCheckKey({...r,[field]:'Changed'},'B1',true),key);
 assert.notEqual(cm.reportCheckKey(r,'B2',true),key);
 assert.notEqual(cm.reportCheckKey(r,'B1',false),key);
});
await check('new evidence before or after cancellation cannot resurrect the old review basis',()=>{
 for(const evidenceAtCancel of ['B1','B2']){
  const initial={...cm.blankReport,summary:'Reviewed',confirmed:true,basis:'B1'};
  const cancelled=tapPatch(initial,null,cm.reportConfirmationKey(initial,evidenceAtCancel),{confirmed:false,basis:'',transferredAt:''});
  const value={...initial,...cancelled.patch};
  const next=tapPatch(value,cancelled.undo,cm.reportConfirmationKey(value,'B2'),{confirmed:true,basis:'B2',transferredAt:''});
  assert.equal(next.patch.basis,'B2');assert.equal(next.patch.confirmed,true);
 }
});
const dataset=mod(path.join(root,'lib/dataset.ts'));await dataset.link((s,r)=>mod(path.resolve(path.dirname(r.identifier),s+'.ts')));await dataset.evaluate();
await check('export distinguishes student review from unrecorded parent-text review and delivery',()=>{
 const payload={...cm.blankReport,summary:'Reviewed',confirmed:true,basis:'B1',parent:'A later draft'};
 const row=dataset.namespace.datasetRecord('class_event',{id:'synthetic',kind:'report',body:JSON.stringify(payload),created_at:at,current_revision:1},'current');
 assert.equal(row.teacher_confirmation_recorded,true);assert.equal(row.teacher_confirmation_scope,'student_lesson_review');
 assert.equal(row.parent_text_review_status,'not_separately_recorded');assert.equal(row.parent_delivery_evidence,'none');
 assert.equal(JSON.stringify(row.payload),JSON.stringify(payload));
});
await check('same-evidence report confirmation remains reversible through the production form hook',()=>{
 slots=[];saves=[];const initial={...cm.blankReport,summary:'Reviewed',confirmed:true,basis:'B1',parent:'Existing wording',transferredAt:at};
 let ui=render(initial,'r0');ui[2](cm.reportConfirmationKey(ui[0],'B1'),{confirmed:false,basis:'',transferredAt:''});
 const cancelled=saves.at(-1).data;render(cancelled,'r1');ui=render(cancelled,'r1');
 ui[2](cm.reportConfirmationKey(ui[0],'B1'),{confirmed:true,basis:'B1',transferredAt:''});
 assert.equal(JSON.stringify(saves.at(-1).data),JSON.stringify(initial));
});
await check('production form hook reconfirms with updated external evidence after its own save acknowledgement',()=>{
 slots=[];saves=[];const initial={...cm.blankReport,summary:'Reviewed',confirmed:true,basis:'B1'};
 let ui=render(initial,'r0');ui[2](cm.reportConfirmationKey(ui[0],'B1'),{confirmed:false,basis:'',transferredAt:''});
 const cancelled=saves.at(-1).data;render(cancelled,'r1');ui=render(cancelled,'r1');
 ui[2](cm.reportConfirmationKey(ui[0],'B2'),{confirmed:true,basis:'B2',transferredAt:''});
 assert.equal(saves.at(-1).data.basis,'B2');assert.equal(saves.at(-1).data.confirmed,true);
});
const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(read('drizzle/'+f));
const DB={
 prepare(q){
  return {bind(...v){
   return {
    async first(){return sql.prepare(q).get(...v)||null},
    async all(){return {results:sql.prepare(q).all(...v)}},
    async run(){const r=sql.prepare(q).run(...v);return {meta:{changes:Number(r.changes)}}}
   };
  }};
 }
};
const removeImports=s=>s.replace(/^import .*?;\s*$/gm,'');
const provenance=mod(path.join(root,'lib/provenance.ts'));await provenance.link((s,r)=>mod(path.resolve(path.dirname(r.identifier),s+'.ts')));await provenance.evaluate();
const ctx={...Object.fromEntries(Object.keys(nm).map(k=>[k,nm[k]])),validateCard:obs.validateCard,isCardKind:obs.isCardKind,canRestoreCard:obs.canRestoreCard,clientRecordedAt:provenance.namespace.clientRecordedAt,validateClass:cm.validateClass,readRoster:async()=>({roster:[{id:'SYNTHETIC'}]}),console,URL,Response,Request,Headers,Date,JSON,crypto,atob,btoa,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,env:{DB},getChatGPTUser:async()=>({email:'fixture@example.invalid'})};
vm.createContext(ctx);vm.runInContext(strip(removeImports(read('lib/server.ts')).replace(/export /g,'')),ctx);
vm.runInContext(strip(removeImports(read('app/api/notebook/route.ts')).replace(/export /g,'')),ctx);const post=ctx.POST;
const owner=await ctx.owner(),sid=randomUUID(),cardId=randomUUID();
sql.prepare('INSERT INTO spt_sessions(id,owner,student_id,class_date,title,purpose,created_at) VALUES(?,?,?,?,?,?,?)').run(sid,owner,'SYNTHETIC','2026-09-09','SYNTHETIC','test',at);
const card={cardId,category:'observed',text:'SYNTHETIC',scene:{id:'synthetic-scene',activity:'fixture',range:'1–3'},deleted:false,occurrenceOf:'',positionSeconds:null};
const req=p=>new Request('https://fixture.invalid/api/notebook',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify(p)});
const entry=(data,baseId='')=>({action:'entry',id:randomUUID(),sessionId:sid,studentId:'SYNTHETIC',date:'2026-09-09',kind:obs.cardKind(cardId),captureId:'',baseId,data});
const good=async p=>{const r=await post(req(p));assert.equal(r.status,200,await r.text());};
let first,deleted,restored;
await check('real API: create → delete → explicit restore → retry keeps same card identity',async()=>{
 first=entry(card);await good(first);deleted=entry({...card,deleted:true},first.id);await good(deleted);
 restored=entry({...card,restoredFrom:deleted.id},deleted.id);await good(restored);await good(restored);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_entries').get().n,3);
 const rows=sql.prepare('SELECT * FROM spt_entries ORDER BY rowid').all();const cards=obs.cardRevisions(rows);assert.equal(cards.length,1);assert.equal(cards[0].card.deleted,false);assert.equal(cards[0].card.scene.range,'1–3');
});
await check('real API: undeclared, retargeted and stale restorations are rejected',async()=>{
 const gone=entry({...restored.data,deleted:true},restored.id);await good(gone);
 for(const p of [entry({...card},gone.id),entry({...card,restoredFrom:deleted.id},deleted.id),entry({...card,restoredFrom:gone.id,text:'changed evidence'},gone.id)])assert.equal((await post(req(p))).status,409);
 const late={...entry(card,first.id),created_at:at,session_id:sid,body:JSON.stringify(card),base_revision_id:first.id};
 assert.equal(obs.cardRevisions([...sql.prepare('SELECT * FROM spt_entries ORDER BY rowid').all(),late])[0].card.deleted,true);
});
console.log(`${count} checks passed; no production requests. Browser and IndexedDB integration remain separate gates.`);

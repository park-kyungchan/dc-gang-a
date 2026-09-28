// Fresh v9 checks against real API routes and IndexedDB, using isolated synthetic data only.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {api,sql,sign,req,good,test} from './pilot-contract.mjs';
const bundle=await build({stdin:{contents:"export * from './lib/activity-time'",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const time=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
sign();const date='2026-09-09',at='2026-09-09T10:00:00.000Z',owner=await api.server.owner();
const event=(id,data,baseId='')=>({id:randomUUID(),entityId:id,studentId:'S004',date,kind:'activity',data,baseId});
const post=p=>api.classroom.POST(req('/api/classroom',p));
let first,next;
await test('v9 assignment replay stores one start; range edits, check waiting and revisit preserve it',async()=>{
 const id=randomUUID();first=event(id,{...api.classModel.task('SYNTHETIC ONLY',date),timing:time.assignedTiming(at)});
 await good(await post(first));await good(await post(first));assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events WHERE entity_id=?').get(id).n,1);
 next=event(id,{...first.data,state:'check',range:'SYNTHETIC RANGE',timing:time.scheduleVisit(first.data.timing,5,true,'2026-09-09T10:13:00.000Z')},first.id);await good(await post(next));
 const saved=JSON.parse(sql.prepare('SELECT body FROM spt_class_events WHERE id=?').get(next.id).body);assert.equal(saved.timing.assignedAt,at);assert.equal(saved.timing.revisitAt,'2026-09-09T10:18:00.000Z');assert.equal(saved.timing.stoppedAt,'');assert.equal(saved.state,'check');
 assert.equal(time.elapsedLabel(saved.timing,Date.parse('2026-09-09T10:18:00Z')),'배정 후 18분');assert.equal(time.revisitDue(saved.timing,Date.parse('2026-09-09T10:18:00Z')),true);
});
await test('v9 timer reset, old-client omission, invalid time and stale revisits cannot overwrite history',async()=>{
 for(const timing of [{...next.data.timing,assignedAt:'2026-09-09T10:01:00.000Z'},undefined])assert.equal((await post(event(first.entityId,{...next.data,timing},next.id))).status,409);
 assert.equal((await post(event(first.entityId,{...next.data,timing:{...next.data.timing,revisitAt:'yesterday'}},next.id))).status,400);
 assert.equal((await post(event(first.entityId,next.data,first.id))).status,409);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events WHERE entity_id=?').get(first.entityId).n,2);
});
await test('v9 legacy records remain unknown; explicit later lesson starts a new time without changing origin',async()=>{
 const legacy=event(randomUUID(),api.classModel.task('LEGACY SYNTHETIC',date));await good(await post(legacy));assert.equal(time.elapsedLabel(legacy.data.timing,Date.now()),'배정 시각 미기록');
 const resumed=event(legacy.entityId,{...legacy.data,workDate:'2026-09-12',timing:time.assignedTiming('2026-09-12T10:00:00.000Z')},legacy.id);await good(await post(resumed));const row=sql.prepare('SELECT * FROM spt_class_events WHERE id=?').get(resumed.id);assert.equal(row.class_date,date);assert.equal(JSON.parse(row.body).timing.assignedAt,'2026-09-12T10:00:00.000Z');
});
await test('v9 offline activity and revisit survive reopening; delivery retry keeps exact timestamps and IDs',async()=>{
 let online=false,lose=true;globalThis.fetch=async(url,opt)=>{if(!online)throw new TypeError('offline');if(url==='/api/identity')return api.identity.GET();const r=await api.classroom.POST(req(url,JSON.parse(opt.body)));if(lose){lose=false;throw new TypeError('ack lost');}return r;};
 const box=new api.DeviceOutbox(owner);await box.read();const draft=event(randomUUID(),{...api.classModel.task('OFFLINE SYNTHETIC',date),timing:time.scheduleVisit(time.assignedTiming(at),10,false,at)});await box.revision('/api/classroom',draft,'class:'+draft.entityId);
 const reopened=new api.DeviceOutbox(owner);await reopened.read();const projected=api.projectData(api.emptyData,reopened.items,date).ledger.find(e=>e.entity_id===draft.entityId);assert.deepEqual(JSON.parse(projected.body).timing,draft.data.timing);
 online=true;await reopened.flush();assert.ok(reopened.pending.length);await reopened.flush();assert.equal(reopened.pending.length,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events WHERE entity_id=?').get(draft.entityId).n,1);
});
await test('v9 explicit finish freezes elapsed time and clears revisit without asserting learning completion',()=>{
 const stopped=time.transitionTiming(next.data.timing,'done','2026-09-09T10:20:00.000Z');assert.equal(time.elapsedLabel(stopped,Date.parse('2026-09-10T10:00:00Z')),'배정 후 경과 20분');assert.equal(time.revisitDue(stopped,Date.now()),false);assert.equal(stopped.assignedAt,at);assert.equal('confirmed' in stopped,false);
});
await test('v9 dataset exports assignment and revisit evidence without converting it to learning outcomes',async()=>{
 const r=await api.dataset.GET(new Request('https://spt.example/api/dataset?from=2026-09-09&to=2026-09-09&view=history'));assert.equal(r.status,200);const rows=(await r.text()).trim().split('\n').map(x=>JSON.parse(x));const row=rows.find(x=>x.id===next.id);assert.ok(row);assert.equal(row.payload.timing.assignedAt,at);assert.equal(row.payload.timing.visitedAt,'2026-09-09T10:13:00.000Z');assert.equal(row.teacher_confirmation_recorded,null);
});

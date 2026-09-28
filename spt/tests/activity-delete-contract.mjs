// Synthetic SQLite and IndexedDB only; never calls the deployed Site.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {api,sql,sign,req,good,test} from './pilot-contract.mjs';
sign();const date='2026-09-09',studentId='S004',owner=await api.server.owner();
const mutation=(entityId,data,baseId='')=>({id:randomUUID(),entityId,kind:'activity',studentId,date,data,baseId});
const post=p=>api.classroom.POST(req('/api/classroom',p));
const timing={assignedAt:'2026-09-09T10:00:00.000Z',stoppedAt:'',visitedAt:'2026-09-09T10:03:00.000Z',revisitAt:'2026-09-09T10:08:00.000Z'};
await test('delete/restore for both lanes retains identity, full body, original time and revision history',async()=>{
 for(const lane of ['student','teacher']){
  const initial=mutation(randomUUID(),{...api.classModel.task('SYNTHETIC DELETE CHECK',date),lane,state:'check',range:'SYNTHETIC 32 / 1–4',note:'retain note',unresolved:'retain followup',timing});await good(await post(initial));
  const deleted=mutation(initial.entityId,{...initial.data,cancelled:true},initial.id);await good(await post(deleted));await good(await post(deleted));assert.equal(api.classModel.isOpen(deleted.data),false);
  const staleRestore=mutation(initial.entityId,initial.data,initial.id);assert.equal((await post(staleRestore)).status,409);
  const restored=mutation(initial.entityId,initial.data,deleted.id);await good(await post(restored));const rows=(await good(await api.classroom.GET(new Request('https://spt.example/api/classroom?entity='+initial.entityId)))).ledger;assert.equal(rows.length,3);assert.deepEqual(JSON.parse(rows.at(-1).body),initial.data);assert.equal(rows.at(-1).class_date,date);
 }
});
await test('deleted completed prerequisite cannot authorize a new dependent completion; restoration permits it',async()=>{
 const prior=mutation(randomUUID(),{...api.classModel.task('SYNTHETIC PREREQUISITE',date),state:'done'});await good(await post(prior));const deleted=mutation(prior.entityId,{...prior.data,cancelled:true},prior.id);await good(await post(deleted));
 const dependent=mutation(randomUUID(),{...api.classModel.task('SYNTHETIC DEPENDENT',date),state:'working',relation:'required',prerequisite:prior.entityId});assert.equal((await post(dependent)).status,409);
 const restored=mutation(prior.entityId,prior.data,deleted.id);await good(await post(restored));await good(await post(dependent));
});
await test('offline deletion survives reopening and retry; restoration uses the saved deletion revision',async()=>{
 let online=false,loseAck=true;globalThis.fetch=async(url,opt)=>{if(!online)throw new TypeError('synthetic offline');if(url==='/api/identity')return api.identity.GET();const r=await post(JSON.parse(opt.body));if(loseAck&&r.ok){loseAck=false;throw new TypeError('synthetic lost acknowledgement')}return r};
 const initial=mutation(randomUUID(),{...api.classModel.task('SYNTHETIC OFFLINE DELETE',date),timing});await good(await post(initial));const deleted=mutation(initial.entityId,{...initial.data,cancelled:true},initial.id),box=new api.DeviceOutbox(owner);await box.read();await box.revision('/api/classroom',deleted,'class:'+initial.entityId);
 const reopened=new api.DeviceOutbox(owner);await reopened.read();const projected=api.projectData(api.emptyData,reopened.items,date).ledger.find(e=>e.entity_id===initial.entityId);assert.equal(JSON.parse(projected.body).cancelled,true);assert.deepEqual(JSON.parse(projected.body).timing,timing);
 online=true;await reopened.flush();assert.ok(reopened.pending.length);await reopened.flush();assert.equal(reopened.pending.length,0);const rows=sql.prepare('SELECT * FROM spt_class_events WHERE entity_id=? ORDER BY rowid').all(initial.entityId);assert.equal(rows.length,2);const restored=mutation(initial.entityId,initial.data,rows.at(-1).id);await good(await post(restored));
});

// Isolated data only. No live student rows, provider calls, or Sheet writes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {indexedDB} from 'fake-indexeddb';
import {api,sql,sign,req,good,test} from './pilot-contract.mjs';
globalThis.indexedDB=indexedDB;
sign();const owner=await api.server.owner(),day='2026-09-09',clientAt='2026-09-08T01:02:03.100Z';
const post=p=>api.notebook.POST(req('/api/notebook',p));
const create=async(purpose='lesson')=>{const id=randomUUID();await good(await post({action:'create',id,studentId:'S004',date:day,title:'SYNTHETIC DATASET CHECK',purpose}));return id;};
const exportRows=async(view='current')=>{const response=await api.dataset.GET(new Request(`https://spt.example/api/dataset?from=${day}&to=${day}&view=${view}`));assert.equal(response.status,200);return (await response.text()).trim().split('\n').map(s=>JSON.parse(s));};

await test('migration adds unknown provenance without rewriting legacy records',()=>{
 const before=new DatabaseSync(':memory:');const migrations=readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort();
 for(const file of migrations.filter(f=>!f.startsWith('0002_')))before.exec(readFileSync('drizzle/'+file,'utf8'));
 before.exec("INSERT INTO spt_sessions VALUES('s','owner','S004','2026-09-09','legacy','2026-09-09T01:00:00Z','lesson',NULL); INSERT INTO spt_entries(id,owner,session_id,kind,body,capture_id,created_at) VALUES('e','owner','s','observation','{\"observed\":\"preserve\"}','','2026-09-09T01:01:00Z'); INSERT INTO spt_class_events VALUES('c','owner','task','S004','2026-09-09','activity','{}','2026-09-09T01:02:00Z');");
 before.exec(readFileSync('drizzle/'+migrations.find(f=>f.startsWith('0002_')),'utf8'));
 for(const table of ['spt_entries','spt_class_events']){const row=before.prepare('SELECT * FROM '+table).get();assert.equal(row.recorded_at_client,null);assert.equal(row.base_revision_id,null);assert.equal(row.schema_version,null);assert.equal(before.prepare('SELECT COUNT(*) n FROM '+table).get().n,1);}
 assert.equal(before.prepare('SELECT body FROM spt_entries').get().body,'{"observed":"preserve"}');assert.equal(before.prepare('SELECT created_at FROM spt_entries').get().created_at,'2026-09-09T01:01:00Z');before.close();
});

await test('offline reopening and lost acknowledgement preserve input time, server time and a single revision',async()=>{
 const sid=await create(),p={action:'entry',id:randomUUID(),sessionId:sid,date:day,studentId:'S004',kind:'observation',baseId:'',data:{observed:'OFFLINE INPUT',studentSaid:'',next:''},recordedAtClient:clientAt};
 const a=new api.DeviceOutbox(owner);await a.read();await a.enqueue(p.id,'/api/notebook',p);const b=new api.DeviceOutbox(owner);await b.read();const stored=b.pending.find(x=>x.payload?.id===p.id).payload;assert.equal(stored.recordedAtClient,clientAt);
 await good(await post(stored));const original=sql.prepare('SELECT * FROM spt_entries WHERE id=?').get(p.id);
 await good(await post(stored));assert.deepEqual(sql.prepare('SELECT * FROM spt_entries WHERE id=?').get(p.id),original);assert.notEqual(original.created_at,clientAt);assert.equal(original.recorded_at_client,clientAt);
 assert.equal((await post({...stored,recordedAtClient:'2026-09-08T02:02:03.100Z'})).status,409);assert.equal((await post({...stored,baseId:randomUUID()})).status,409);
 const revised={...p,id:randomUUID(),baseId:p.id,data:{...p.data,next:'FOLLOW UP'}};await good(await post(revised));assert.equal(sql.prepare('SELECT base_revision_id FROM spt_entries WHERE id=?').get(revised.id).base_revision_id,p.id);
 assert.equal((await post({...revised,id:randomUUID(),baseId:p.id})).status,409);
 const local=api.projectData({...api.emptyData,sessions:[{id:sid,student_id:'S004',class_date:day,title:'TEST',created_at:clientAt}]},b.items,day);
 assert(api.model.exportDay(day,local.sessions,local.events,[]).includes('서버 수신시각 미확인'));
 const server=await good(await api.notebook.GET(new Request('https://spt.example/api/notebook?date='+day)));assert(api.model.exportDay(day,server.sessions,server.events,[]).includes('서버 수신시각 '+original.created_at));
});

await test('invalid calendar input is rejected; fractional seconds and leap days normalize safely',async()=>{
 const sid=await create();for(const time of ['2026-02-31T12:30:00.000Z','2026-09-09T24:00:00.000Z','not-a-time'])assert.equal((await post({action:'entry',id:randomUUID(),sessionId:sid,kind:'recording_notice',data:{text:'test'},recordedAtClient:time})).status,400);
 for(const [time,expected] of [['2028-02-29T01:02:03.1Z','2028-02-29T01:02:03.100Z'],[undefined,null]]){const id=randomUUID();await good(await post({action:'entry',id,sessionId:sid,kind:'recording_notice',data:{text:'test'},recordedAtClient:time}));assert.equal(sql.prepare('SELECT recorded_at_client FROM spt_entries WHERE id=?').get(id).recorded_at_client,expected);}
});

await test('dataset excludes test sessions and deleted current text, preserves historical status and distinguishes drafts',async()=>{
 const sid=await create(),testSid=await create('test'),cardId=randomUUID(),card={action:'entry',id:randomUUID(),sessionId:sid,date:day,studentId:'S004',kind:'observation_card:'+cardId,baseId:'',data:{cardId,category:'observed',text:'DELETED_CARD_ONLY',scene:{id:'test',activity:'test',range:'1'},deleted:false,occurrenceOf:'',positionSeconds:null},recordedAtClient:clientAt};
 await good(await post(card));const deleted={...card,id:randomUUID(),baseId:card.id,data:{...card.data,deleted:true}};await good(await post(deleted));
 await good(await post({action:'entry',id:randomUUID(),sessionId:testSid,kind:'transcript',data:{text:'TEST_SESSION_SECRET'}}));
 const aid=randomUUID();await good(await post({action:'entry',id:aid,sessionId:sid,kind:'ai_draft',baseId:'',data:{text:'DRAFT_NOT_CONFIRMED'}}));
 // Exercise pagination even when every record in an early page is omitted.
 for(let i=0;i<24;i++)await good(await post({action:'entry',id:randomUUID(),sessionId:sid,kind:'recording_notice',data:{text:'PAGE '+i}}));
 const current=await exportRows(),history=await exportRows('history');
 assert(!JSON.stringify(current).includes('DELETED_CARD_ONLY'));assert(!JSON.stringify(history).includes('TEST_SESSION_SECRET'));assert(!JSON.stringify(history).includes(testSid));
 assert.equal(history.find(x=>x.id===card.id).revision_state,'superseded');assert.equal(history.find(x=>x.id===card.id).entity_deleted,true);assert.equal(history.find(x=>x.id===deleted.id).revision_state,'current');
 assert.equal(current.find(x=>x.id===aid).record_stage,'ai_draft');assert.equal(current.find(x=>x.id===aid).teacher_confirmation_recorded,null);
 assert.equal(current.at(-1).record_type,'export_complete');assert(current.some(x=>x.payload?.text==='PAGE 23'));
 assert.equal(current.find(x=>x.id===sid).created_at_semantics,'legacy_creation_time_source_not_separated');
 assert(current.filter(x=>x.record_type==='audio_chunk').every(x=>!('object_key' in x)));assert(current.every(x=>!('owner' in x)));
});

await test('classroom revisions retain client time and exported confirmation is not actual parent delivery',async()=>{
 const id=randomUUID(),entityId='report:S004:'+day,data={draft:'AI DRAFT',summary:'TEACHER',needs:'',next:'',parent:'DRAFT PARENT',confirmed:true,basis:'synthetic-only',transferredAt:clientAt},p={id,entityId,studentId:'S004',date:day,kind:'report',data,baseId:'',recordedAtClient:clientAt};
 for(const r of await Promise.all([api.classroom.POST(req('/api/classroom',p)),api.classroom.POST(req('/api/classroom',p))]))await good(r);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events WHERE id=?').get(id).n,1);assert.equal((await api.classroom.POST(req('/api/classroom',{...p,recordedAtClient:'2026-09-08T03:00:00Z'}))).status,409);
 const row=(await exportRows()).find(x=>x.id===id);assert.equal(row.client_input_at,clientAt);assert.equal(row.parent_delivery_evidence,'teacher_marked_only');assert.equal(row.teacher_confirmation_recorded,true);
});

await test('export authentication, ownership and range bounds hold',async()=>{
 for(const query of ['from=2026-02-30&to=2026-03-01','from=2026-08-01&to=2026-09-09','from=2026-09-10&to=2026-09-09'])assert.equal((await api.dataset.GET(new Request('https://spt.example/api/dataset?'+query))).status,400);
 sign('dataset-other-teacher');assert.deepEqual((await exportRows()).map(x=>x.record_type),['manifest','export_complete']);globalThis.__sptHeaders=new Headers();assert.equal((await api.dataset.GET(new Request(`https://spt.example/api/dataset?from=${day}&to=${day}`))).status,401);sign();
});

await test('concurrent new recording stays outside export cutoffs and exported references remain complete',async()=>{
 const response=await api.dataset.GET(new Request(`https://spt.example/api/dataset?from=${day}&to=${day}&view=history`));
 const sid=await create(),cid=randomUUID(),eid=randomUUID();await good(await api.capture.POST(req('/api/capture',{action:'start',id:cid,sessionId:sid})));await good(await post({action:'entry',id:eid,sessionId:sid,captureId:cid,kind:'transcript',data:{text:'AFTER EXPORT START'}}));
 const rows=(await response.text()).trim().split('\n').map(s=>JSON.parse(s)),ids=new Set(rows.map(r=>r.id));assert(!ids.has(sid)&&!ids.has(cid)&&!ids.has(eid));
 for(const r of rows){if(r.session_id)assert(ids.has(r.session_id));if(r.capture_id)assert(ids.has(r.capture_id));}
});
